/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['./abj_price_pricelist_helper', 'N/log', 'N/record','N/search'], (priceListHelper, log, record, search) => {

  const getComponentItems = (bundleItemId) => {
    const componentItems = [];
    try {
      const searchObject = search.create({
        type: 'item',
        filters: [
          ['internalid', 'anyof', bundleItemId]
        ],
        columns: ['memberitem','memberquantity']
      });
      const searchResults = searchObject.run().getRange({ start: 0, end: 1000 });
      searchResults.forEach(result => {
        const memberItemId = result.getValue('memberitem');
        const memberQuantity = result.getValue('memberquantity');
        if (memberItemId) {
          componentItems.push({ itemId: memberItemId, quantity: memberQuantity });
        }
      });
    } catch (error) {
      log.error({ title: 'Error fetching component items', details: error });
    }
    return componentItems;
  }

  const initializeComponentItems = (transactionRecord) => {
    const lineCount = transactionRecord.getLineCount({ sublistId: 'item' });
    for (let i = 0; i < lineCount; i++) {
      const itemId = transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
      const itemType = transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line : i });
      const quantity = transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
      log.debug(`Line ${i + 1}: itemId=${itemId}, itemType=${itemType}`);
      const isKitItem = itemType === 'Kit';
      if (itemId && isKitItem) {
        const componentItems = getComponentItems(itemId);
        log.debug(`Component items for bundle item ${itemId}:`, componentItems);
        let newLineIndex = i + 1; // Start inserting after the current line
        componentItems.forEach(component => {
          transactionRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', value: component.itemId, line: newLineIndex });
          transactionRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity, line: newLineIndex });
          // transactionRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', value: component.quantity * quantity, line: newLineIndex });
          newLineIndex++; // Move to the next line for the next component
        });
      }
      
    }
  }


  const beforeSubmit = (context) => {
    log.debug({ title: 'abj_ue_usage beforeSubmit', details: context });
    try {
      const allowedEventTypes = [
        context.UserEventType.CREATE,
        context.UserEventType.EDIT,
        context.UserEventType.COPY
      ];

      if (!allowedEventTypes.includes(context.type)) {
        return;
      }
      const transactionRecord = context.newRecord;
      // 1. GENERATE COMPONENT ITEMS DARI BUNDLE
      initializeComponentItems(transactionRecord);

      priceListHelper.applyPriceListToTransaction({
        transactionRecord: transactionRecord
      });
    } catch (error) {
      log.error({ title: 'abj_ue_usage beforeSubmit error', details: error });
      const handledErrors = [
          'PRICE_LIST_ACCOUNT_MISMATCH', 
          'PRICE_LIST_NOT_FOUND', 
          'PRICE_LIST_PREPAID_QUOTA_EXHAUSTED',
          'PRICE_LIST_ALLOCATION_FAILED'
      ];

      if (error && handledErrors.includes(error.name)) {
        throw error.message;
      }
      throw error;
    }
  };

  const afterSubmit = (context) => {
    log.debug('AFTER SUBMIT', 'AFTER SUBMIT');
    try {
      const allowedEventTypes = [
        context.UserEventType.CREATE,
        context.UserEventType.EDIT,
        context.UserEventType.DELETE
      ];

      if (!allowedEventTypes.includes(context.type)) {
        return;
      }

      // Map untuk mengelompokkan update per SO agar record.load hanya dipanggil sekali per SO
      // Format: { soId: { soLineId: deltaQuantity } }
      const usageUpdatesMap = {};

      // Helper untuk menghitung kuota (positif saat ditambah/CREATE, negatif saat dikurangi/DELETE)
      const processLines = (transactionRecord, multiplier) => {
        if (!transactionRecord) return;
        
        const lineCount = transactionRecord.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < lineCount; i++) {
          const soId = transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_so_id', line: i });
          const soLineId = transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_order_line', line: i });
          const quantity = Number(transactionRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
          log.debug('DATA SO', {
            soId,soLineId,quantity
          })

          if (soId && soLineId) {
            if (!usageUpdatesMap[soId]) {
              usageUpdatesMap[soId] = {};
            }
            if (!usageUpdatesMap[soId][soLineId]) {
              usageUpdatesMap[soId][soLineId] = 0;
            }
            // Kalkulasi delta qty
            usageUpdatesMap[soId][soLineId] += (quantity * multiplier);
          }
        }
      };

      // 1. Tentukan Delta berdasarkan tipe aksi
      if (context.type === context.UserEventType.CREATE) {
        processLines(context.newRecord, 1); // Tambah usage
      } else if (context.type === context.UserEventType.EDIT) {
        processLines(context.oldRecord, -1); // Kembalikan usage lama
        processLines(context.newRecord, 1);  // Tambahkan usage baru
      } else if (context.type === context.UserEventType.DELETE) {
        processLines(context.oldRecord, -1); // Kembalikan usage lama karena transaksi dihapus
      }

      // 2. Eksekusi Update ke Historical Sales Order
      Object.keys(usageUpdatesMap).forEach((soId) => {
        const lineUpdates = usageUpdatesMap[soId];
        let needsSave = false;

        try {
          var soRecord = null;
          try {
            soRecord = record.load({
              type: record.Type.SALES_ORDER, // it can be from sales order or invoice, needs transaction type
              id: soId,
              isDynamic: false
            });
          } catch (error) {
            soRecord = record.load({
              type: record.Type.INVOICE, // it can be from sales order or invoice, needs transaction type
              id: soId,
              isDynamic: false
            });
          }
          

          const soLineCount = soRecord.getLineCount({ sublistId: 'item' });
          
          for (let i = 0; i < soLineCount; i++) {
            // Dalam SuiteQL (transactionline.id), nilainya setara dengan field ID 'line' atau 'lineuniquekey' di UI.
            // Kita cek keduanya agar aman dari perbedaan arsitektur form NetSuite.
            const currentLineId = String(soRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i }));
            const currentLineUnique = String(soRecord.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line: i }));
            const itemType = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });

            if(itemType === 'Kit') {
              // Jika item adalah Kit, kita skip update usage karena kita hanya ingin mengupdate usage untuk komponen individual.
              log.debug(`Skipping line ${i + 1} for SO ID ${soId} because it's a Kit item.`);
              continue;
            }

            // Cari apakah baris ini perlu di-update berdasarkan Map kita
            let targetDelta = null;
            if (lineUpdates[currentLineId] !== undefined) {
              targetDelta = lineUpdates[currentLineId];
            } else if (lineUpdates[currentLineUnique] !== undefined) {
              targetDelta = lineUpdates[currentLineUnique];
            }

            // Jika delta ada dan tidak 0
            if (targetDelta !== null && targetDelta !== 0) {
              const currentUsage = Number(soRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_abj_qty_usage',
                line: i
              })) || 0;

              const newUsage = currentUsage + targetDelta;

              soRecord.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_abj_qty_usage',
                line: i,
                value: newUsage >= 0 ? newUsage : 0 // Cegah usage menjadi minus
              });

              needsSave = true;
            }
          }

          if (needsSave) {
            const savedId = soRecord.save({
              ignoreMandatoryFields: true // Cegah error validasi saat save SO lama
            });
            log.debug({ title: 'Successfully Updated Usage for SO', details: 'SO ID: ' + savedId });
          }

        } catch (updateError) {
          log.error({
            title: 'Error updating Historical SO Usage',
            details: `Failed to update SO ID: ${soId}. Error: ${String(updateError)}`
          });
        }
      });

    } catch (error) {
      log.error({ title: 'abj_ue_usage afterSubmit error', details: error });
      // Di afterSubmit, optional untuk re-throw. Biasanya kita biarkan agar transaksi current 
      // tetap tersimpan meski update historical gagal, tapi jika dirasa krusial, silakan di-throw.
    }
  };

  return {
    beforeSubmit,
    afterSubmit
  };
});