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
            // Karena menggunakan setSublistValue, isDynamic false (Standard Mode) lebih cocok
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

            // Format tanggal dari saved search (formula {today} biasanya me-return string)
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
            return []; // Mengembalikan array kosong untuk menghentikan Map/Reduce dengan aman
        }

        log.audit('Status Execution', `Found ${count} record(s) to process.`);

        return searchData;
    };

    /**
     * Fase map
     */
    const map = (context) => {
        try {
            const searchResult = JSON.parse(context.value);
            const values = searchResult.values;
            log.debug('values', values);
            
            // Mapping data berdasarkan struktur kolom dari pencarian Anda
            const mappedData = {
                // Gunakan opsional chaining `?.[0]?.value` karena field List/Record me-return array object di Map/Reduce
                customer: values.entity?.value || values.entity,
                customerHierarchyConfigId: values.custbody_abj_id_cust_hierarchy_con?.value || values.custbody_abj_id_cust_hierarchy_con,
                customerHierarchyId: values.custcol_abj_privy_customer_hierarchy_?.value || values.custcol_abj_privy_customer_hierarchy_,
                currencyId: values.currency?.value || values.currency,
                itemId: values.item?.value || values.item,
                
                // Formula field biasanya me-return nilai secara langsung
                trandate: values.custcol_abj_billing_end_date,
                quantity: values.formulanumeric,
                
                orderId: searchResult.id, // Internal ID Sales Order untuk orderId
                refNumber: 'USG-EXP-' + searchResult.id // Modifikasi penamaan refNumber jika diperlukan
            };

            // Validasi: pastikan item dan quantity tidak kosong
            if (mappedData.itemId && mappedData.quantity) {
                context.write({
                    key: searchResult.id,
                    value: mappedData
                });
            } else {
                log.debug('Map Skipped', `Data dilewati karena Item atau Quantity kosong. SO ID: ${searchResult.id}`);
            }

        } catch (e) {
            log.error('Map Error - Key: ' + context.key, e.message);
        }
    };

    /**
     * Fase reduce
     */
    const reduce = (context) => {
        try {
            const data = JSON.parse(context.values[0]);
            log.debug('Reduce Data', `Memproses Usage Record untuk SO ID: ${context.key} dengan data: ${JSON.stringify(data)}`);
            
            // Eksekusi pembuatan record
            const result = createUsageRecord(data);

            if (result.status) {
                log.audit('Success', `Usage Record dibuat dengan ID: ${result.id} (Referensi SO ID: ${context.key})`);
            } else {
                log.error('Creation Failed', `Gagal membuat Usage untuk SO ID: ${context.key}. Alasan: ${result.message}`);
            }

        } catch (e) {
            log.error('Reduce Error - Key: ' + context.key, e.message);
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