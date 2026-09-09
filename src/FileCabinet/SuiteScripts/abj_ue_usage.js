/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['./abj_price_pricelist_helper', 'N/log', 'N/record'], (priceListHelper, log, record) => {
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

      priceListHelper.applyPriceListToTransaction({
        transactionRecord: context.newRecord
      });
    } catch (error) {
      log.error({ title: 'abj_ue_usage beforeSubmit error', details: error });
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
          const soRecord = record.load({
            type: record.Type.SALES_ORDER,
            id: soId,
            isDynamic: false
          });

          const soLineCount = soRecord.getLineCount({ sublistId: 'item' });
          
          for (let i = 0; i < soLineCount; i++) {
            // Dalam SuiteQL (transactionline.id), nilainya setara dengan field ID 'line' atau 'lineuniquekey' di UI.
            // Kita cek keduanya agar aman dari perbedaan arsitektur form NetSuite.
            const currentLineId = String(soRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i }));
            const currentLineUnique = String(soRecord.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line: i }));

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