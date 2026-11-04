/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/file', 'N/format'], (record, search, runtime, file, format) => {

    const parseCSV = (csvContent) => {
        let lines = csvContent.split(/\r?\n/);
        let result = [];
        
        for (let i = 1; i < lines.length; i++) {
            let line = lines[i];
            if (!line) continue;

            // Regex untuk split koma, mengabaikan koma di dalam tanda kutip ("")
            let columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            const cleanText = (val) => val ? val.replace(/(^"|"$)/g, '').trim() : '';
            const parseNum = (val) => parseFloat(cleanText(val).replace(/,/g, '')) || 0;

            result.push({
                merchant_name: cleanText(columns[1]),
                transaction_date: cleanText(columns[3]),
                doku_invoice: cleanText(columns[4]),
                amount: parseNum(columns[6]),
                fee: parseNum(columns[8]),
                payout_date: cleanText(columns[10]),
                qris_transaction_id: cleanText(columns[14])
            });
        }
        return result;
    };
    
    const getInputData = () => {
        const scriptObj = runtime.getCurrentScript();
        const fileId = scriptObj.getParameter({ name: 'custscript_mr_file_id' });
        
        if (!fileId) return [];

        const fileObj = file.load({ id: fileId });
        const csvContent = fileObj.getContents();
        
        let dataToProcess = parseCSV(csvContent);
        
        return dataToProcess; 
    };

    const map = (context) => {
        try {
            const scriptObj = runtime.getCurrentScript();
            const bankAccount = scriptObj.getParameter({ name: 'custscript_mr_account' });
            const paymentMethod = scriptObj.getParameter({ name: 'custscript_mr_payment_method' });
            
            
            let row = JSON.parse(context.value);
            log.debug('map : value', row)
            log.debug('map : value qris_transaction_id', row.qris_transaction_id)
            
           
            const searchObject = search.load({ id: 'customsearch_abj_pg_settlement' });
            let dynamicFilter = ['custbody_abj_pg_order_id', 'is', row.qris_transaction_id];

            // 2. Gabungkan dengan aman ke filter bawaan Saved Search
            let existingFilters = searchObject.filterExpression;
            if (existingFilters && existingFilters.length > 0) {
                searchObject.filterExpression = [existingFilters, 'AND', dynamicFilter];
            } else {
                searchObject.filterExpression = [dynamicFilter];
            }
            
            let nsData = null;
            let totalAmount = 0;

            searchObject.run().each(result => {
                if (!nsData) {
                    nsData = {      
                        internalid: result.getValue({ name: 'internalid', summary: search.Summary.GROUP }) || '',
                        order_id: result.getValue({ name: 'custbody_abj_pg_order_id', summary: search.Summary.GROUP }) || '',
                        customer: result.getValue({ name: 'entity', summary: search.Summary.GROUP }) || '', 
                        customer_text: result.getText({ name: 'entity', summary: search.Summary.GROUP }) || '', 
                        date: result.getValue({ name: 'trandate', summary: search.Summary.GROUP }) || '',
                        payout_date: result.getValue({ name: 'trandate', join: 'payingtransaction', summary: search.Summary.GROUP }) || ''
                    };
                }
                totalAmount += (parseFloat(result.getValue({ name: 'amountremaining', summary: search.Summary.SUM })) || 0);

                return true; 
            });

            
            if (nsData) {
                nsData.grand_total = totalAmount;
            }

            
            if (nsData) {
                // Syarat Match (Kecuali Invoice No & Fee)
                let isCustomerMatch   = (nsData.customer_text === row.merchant_name);
                let isDateMatch       = (nsData.date === row.transaction_date);
                let isPayoutDateMatch = (nsData.payout_date === row.payout_date);
                let isGrandTotalMatch = (nsData.grand_total === row.amount);

                if (isDateMatch && isGrandTotalMatch) {
                            
                    let cpRec = record.create({
                        type: record.Type.CUSTOMER_PAYMENT,
                        isDynamic: true,
                        defaultValues: {
                            invoices: nsData.internalid
                        }
                    });
                    
                   
                    cpRec.setValue({ fieldId: 'customer', value: nsData.customer });
                    // cpRec.setValue({ fieldId: 'payment', value: row.amount });
                    const parsedDate = format.parse({ value: row.payout_date, type: format.Type.DATE });
                    cpRec.setValue({ fieldId: 'trandate', value: parsedDate  });
                    cpRec.setValue({ fieldId: 'memo', value: "Recon : "+ nsData.order_id });
                    
                    if (bankAccount) cpRec.setValue({ fieldId: 'account', value: bankAccount });
                    if (paymentMethod) cpRec.setValue({ fieldId: 'paymentmethod', value: paymentMethod });

                    
                    let lineCount = cpRec.getLineCount({ sublistId: 'apply' });
                    for (let i = 0; i < lineCount; i++) {
                        let lineInvoiceId = cpRec.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
                        
                        if (lineInvoiceId == nsData.internalid) {
                            cpRec.selectLine({ sublistId: 'apply', line: i });
                            cpRec.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                            log.debug('row amount', row.amount)
                            log.debug('ns data amount', row.grand_total)
                            cpRec.setCurrentSublistValue({
                                sublistId: 'apply',
                                fieldId: 'amount',
                                value: Number(row.amount) - Number(row.fee)
                            });
                            cpRec.commitLine({ sublistId: 'apply' });
                            break;
                        }
                    }

                    
                    let adjSublistId = 'paymentadjustment';
                    
                    try {
                        cpRec.selectNewLine({ sublistId: adjSublistId });
                        cpRec.setCurrentSublistValue({ sublistId: adjSublistId, fieldId: 'paymentadjustment', value: 1 }); 
                        cpRec.setCurrentSublistValue({ sublistId: adjSublistId, fieldId: 'amount', value: row.fee }); 
                        
                        cpRec.commitLine({ sublistId: adjSublistId });
                    } catch (err) {
                        log.error('Adjustment Sublist Error', 'Sublist ID tidak ditemukan atau salah ID: ' + err.message);
                    }

                    // Save Record
                    let cpId = cpRec.save();
                    log.debug('Payment Created', `Customer Payment ID ${cpId} sukses dibuat untuk Order ID: ${row.qris_transaction_id}`);
                } else {
                    log.debug('Data Not Matched', `Data NetSuite ketemu tapi tidak cocok kriteria match. Order ID: ${row.qris_transaction_id}`);
                }
            } else {
                log.debug('Data Not Found', `Saved Search tidak menemukan Order ID: ${row.qris_transaction_id}`);
            }

        } catch (e) {
            log.error('Map Error', e.message);
        }
    };

    // 3. SUMMARIZE: Menampilkan Log Error jika ada kegagalan
    const summarize = (summary) => {
        log.audit('Map/Reduce Selesai', `Total data diproses (CSV baris): ${summary.mapSummary.keys.length}`);
        
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error(`Map Error pada key ${key}`, error);
            return true;
        });
    };

    return { getInputData, map, summarize };
});