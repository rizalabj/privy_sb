/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log', 'N/format'], (record, search, log, format) => {

    /** 
     * Helper Functions dari User
     */
    const setFieldValue = (rec, fieldId, value) => {
        if (value) {
            rec.setValue({
                fieldId: fieldId,
                value: value
            });
        }
    };

    const setSublistFieldValue = (rec, sublistId, fieldId, value, line) => {
        if (value != null && value != undefined && value !== '') {
            rec.setSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value,
                line: line
            });
        }
    };

    /**
     * Fungsi custom untuk membuat record usage
     */
    const createUsageRecord = ({
        customer,
        customerHierarchyConfigId,
        customerHierarchyId,
        trandate,
        orderId,
        refNumber,
        currencyId,
        itemId,
        quantity
    }) => {
        try {
            let rec = record.create({
                type: 'customsale_abj_usage_pre_postpaid'
            });

            // Set Body Fields
            setFieldValue(rec, 'entity', customer);
            setFieldValue(rec, 'custbody_abj_id_cust_hierarchy_con', customerHierarchyConfigId);
            setFieldValue(rec, 'custbody_abj_hierarchy_customer_', customerHierarchyId);
            setFieldValue(rec, 'custbody_abj_pg_order_id', orderId);
            setFieldValue(rec, 'custbody_abj_usage_ref_number', refNumber);
            setFieldValue(rec, 'currency', currencyId);
            setFieldValue(rec, 'custbody_abj_usage_expired', true);
            setFieldValue(rec, 'memo', 'Usage Expired, item :'+itemId+'');

            // Format tanggal
            if (trandate) {
                const parsedDate = format.parse({ value: trandate, type: format.Type.DATE });
                setFieldValue(rec, 'trandate', parsedDate);
            }

            // Trigger account & exchange rate default
            let account = rec.getValue('account');
            let exchangeRate = rec.getValue('exchangerate');
            
            setFieldValue(rec, 'account', account);
            setFieldValue(rec, 'exchangerate', exchangeRate);

            // Set Sublist Fields
            let i = 0;
            setSublistFieldValue(rec, 'item', 'item', itemId, i);
            setSublistFieldValue(rec, 'item', 'quantity', quantity, i);

            let recId = rec.save();
            return {
                status: true,
                message: 'Usage created successfully.',
                id: recId
            };
        } catch (error) {
            return {
                status: false,
                message: error.message,
                id: null
            };
        }
    };

    /**
     * Fase getInputData
     */
    const getInputData = (context) => {
        let searchData = search.load({
            id: 'customsearch_abj_usage_expiration'
        });

        const count = searchData.runPaged().count;

        if (count === 0) {
            log.audit('Status Execution', 'Nothing to execute');
            return [];
        }

        log.audit('Status Execution', `Found ${count} record(s) to process.`);

        return searchData;
    };

    /**
     * Fase map
     * Membuat Usage Record per baris SO. Jika berhasil, lempar data baris ke Reduce.
     */
    const map = (context) => {
        try {
            const searchResult = JSON.parse(context.value);
            const values = searchResult.values;
            const soId = searchResult.id;
            
            const mappedData = {
                customer: values.entity?.value || values.entity,
                customerHierarchyConfigId: values.custbody_abj_id_cust_hierarchy_con?.value || values.custbody_abj_id_cust_hierarchy_con,
                customerHierarchyId: values.custcol_abj_privy_customer_hierarchy_?.value || values.custcol_abj_privy_customer_hierarchy_,
                currencyId: values.currency?.value || values.currency,
                itemId: values.item?.value || values.item,
                trandate: values.custcol_abj_billing_end_date,
                quantity: values.formulanumeric,
                orderId: soId,
                refNumber: 'USG-EXP-' + soId,
                lineId: values.line
            };

            if (mappedData.itemId && mappedData.quantity) {
                // Eksekusi pembuatan usage langsung di Map (per line/baris)
                const usageResult = createUsageRecord(mappedData);

                if (usageResult.status) {
                    log.audit('Usage Created', `Berhasil membuat Usage ID: ${usageResult.id} untuk SO ID: ${soId}, Line: ${mappedData.lineId}`);
                    
                    // Lempar SO ID sebagai key, dan data line yang perlu diupdate sebagai value ke reduce
                    context.write({
                        key: soId,
                        value: {
                            lineId: mappedData.lineId,
                            quantity: mappedData.quantity
                        }
                    });
                } else {
                    log.error('Usage Creation Failed', `Gagal membuat Usage untuk SO ID: ${soId}, Line: ${mappedData.lineId}. Alasan: ${usageResult.message}`);
                }
            } else {
                log.debug('Map Skipped', `Data dilewati karena Item atau Quantity kosong. SO ID: ${soId}`);
            }

        } catch (e) {
            log.error('Map Error - Key: ' + context.key, e.message);
        }
    };

    /**
     * Fase reduce
     * Meload SO sekali berdasarkan Key, melooping semua baris yang telah berhasil diproses di Map, mengupdate sublist, lalu Save.
     */
    const reduce = (context) => {
        const soId = context.key;
        
        try {
            // values berisi array dari object baris (line) dari fase Map yang memiliki Key SO ID yang sama
            const linesToUpdate = context.values.map(val => JSON.parse(val));
            log.debug('Reduce Data', `Memproses Update SO ID: ${soId} untuk ${linesToUpdate.length} baris.`);
            
            const soRec = record.load({
                type: 'salesorder',
                id: soId
            });
            
            let lineCount = soRec.getLineCount({ sublistId: 'item'});
            let isUpdated = false;

            // Loop untuk setiap baris yang dilempar dari Map
            linesToUpdate.forEach(data => {
                for (let index = 0; index < lineCount; index++) {
                    let currentLineId = soRec.getSublistValue({ fieldId: 'line', sublistId: 'item', line: index });
                    
                    if (currentLineId == data.lineId) {
                        soRec.setSublistValue({ 
                            fieldId: 'custcol_abj_qty_expired', 
                            sublistId: 'item', 
                            line: index, 
                            value: data.quantity
                        });
                        isUpdated = true;
                    }        
                }
            });

            // Hanya save SO jika ada baris yang diubah
            if (isUpdated) {
                let updatedSOId = soRec.save();
                log.audit('Success', `SO UPDATED: ${updatedSOId} dengan sukses.`);
            }

        } catch (e) {
            log.error('Reduce Error - SO ID: ' + soId, e.message);
        }
    };

    /**
     * Fase summarize
     */
    const summarize = (summary) => {
        log.audit('Execution Summary', `Waktu Eksekusi: ${summary.seconds} detik`);
        
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error(`Map Error - key: ${key}`, error);
            return true;
        });

        summary.reduceSummary.errors.iterator().each((key, error) => {
            log.error(`Reduce Error - key: ${key}`, error);
            return true;
        });
    };

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});