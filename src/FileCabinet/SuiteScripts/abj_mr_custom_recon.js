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
                index: i,
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

    
    const createCustomerPayment = (options) => {
        log.debug('Creating Customer Payment Data : ', options);
        let invoiceIds = options.invoicesToApply.map(inv => inv.id);
        let cpRec = record.create({
            type: record.Type.CUSTOMER_PAYMENT,
            isDynamic: true,
            defaultValues: {
                invoices : invoiceIds.join(',')
            }
        });
        
        // 1. Set Body Fields Dasar
        cpRec.setValue({ fieldId: 'customer', value: options.customerId });
        cpRec.setValue({ fieldId: 'trandate', value: options.trandate });
        cpRec.setValue({ fieldId: 'memo', value: options.memo });
        
        if (options.bankAccount) cpRec.setValue({ fieldId: 'account', value: options.bankAccount });
        if (options.paymentMethod) cpRec.setValue({ fieldId: 'paymentmethod', value: options.paymentMethod });
        if (options.paymentType) cpRec.setValue({ fieldId: 'custbody_abj_payment_type', value: options.paymentType });

        // 3. Apply ke Invoice (Jika ada tagihan yang dilempar)
        if (options.invoicesToApply && options.invoicesToApply.length > 0) {
            let lineCount = cpRec.getLineCount({ sublistId: 'apply' });
            for (let i = 0; i < lineCount; i++) {
                let lineInvoiceId = cpRec.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
                
                let matchedInv = options.invoicesToApply.find(inv => inv.id == lineInvoiceId);
                if (matchedInv) {
                    cpRec.selectLine({ sublistId: 'apply', line: i });
                    cpRec.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                    cpRec.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: matchedInv.applyAmount });
                    cpRec.commitLine({ sublistId: 'apply' });
                }
            }
        }

        // Simpan dan kembalikan ID
        return cpRec.save();
    };
    
    const getInputData = () => {
        const scriptObj = runtime.getCurrentScript();
        const fileId = scriptObj.getParameter({ name: 'custscript_mr_file_id' });
        const selectedIndex = scriptObj.getParameter({ name: 'custscript_selected_index' });
        
        if (!fileId) return [];

        const fileObj = file.load({ id: fileId });
        const csvContent = fileObj.getContents();
        
        let dataToProcess = parseCSV(csvContent);
        dataToProcess = dataToProcess.filter(row => selectedIndex.includes(row.index));
        
        return dataToProcess; 
    };

    const map = (context) => {
        try {
            let row = JSON.parse(context.value);
            
            const searchObject = search.load({ id: 'customsearch_abj_pg_settlement' });
            let dynamicFilter = ['custbody_abj_pg_order_id', 'is', row.qris_transaction_id];

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

            if (nsData) nsData.grand_total = totalAmount;

            if (nsData) {
                let isCustomerMatch   = (nsData.customer_text === row.merchant_name);
                let isDateMatch       = (nsData.date === row.transaction_date);
                let isPayoutDateMatch = (nsData.payout_date === row.payout_date);
                let isGrandTotalMatch = (nsData.grand_total === row.amount);

                if (isDateMatch && isGrandTotalMatch) {
                    // Buat Grouping Key: Gabungan ID Customer dan Payout Date
                    let groupKey = `${nsData.customer}|${row.payout_date}`;

                    // Lempar data ke reduce
                    context.write({
                        key: groupKey,
                        value: {
                            invoice_id: nsData.internalid,
                            order_id: nsData.order_id,
                            amount: Number(row.amount),
                            fee: Number(row.fee)
                        }
                    });
                } else {
                    log.debug('Data Not Matched', `Order ID: ${row.qris_transaction_id}`);
                }
            } else {
                log.debug('Data Not Found', `Order ID: ${row.qris_transaction_id}`);
            }

        } catch (e) {
            log.error('Map Error', e.message);
        }
    };

    const reduce = (context) => {
        try {
            const scriptObj = runtime.getCurrentScript();
            const bankAccount = scriptObj.getParameter({ name: 'custscript_mr_account' });
            const paymentMethod = scriptObj.getParameter({ name: 'custscript_mr_payment_method' });

            const keyParts = context.key.split('|');
            const customerId = keyParts[0];
            const payoutDate = keyParts[1];

            let invoicesToApply = [];
            let invoicesToApplyFee = [];
            let orderIdsMemo = [];

            context.values.forEach(val => {
                let data = JSON.parse(val);
                orderIdsMemo.push(data.order_id);
                
                invoicesToApply.push({
                    id: data.invoice_id,
                    applyAmount: data.amount - data.fee 
                });
                if (data.fee > 0) {
                    invoicesToApplyFee.push({
                        id: data.invoice_id,
                        applyAmount: data.fee 
                    });
                }
            });

            const parsedDate = format.parse({ value: payoutDate, type: format.Type.DATE });
            let memoText = "Recon Group: " + orderIdsMemo.join(', ');
            if (memoText.length > 300) memoText = memoText.substring(0, 297) + '...';

            
            let mainPaymentId = createCustomerPayment({
                customerId: customerId,
                trandate: parsedDate,
                memo: memoText,
                bankAccount: bankAccount,
                paymentMethod: paymentMethod,
                invoicesToApply: invoicesToApply,
                paymentType : 6
            });
            log.debug('Main Payment Created', `Payment ID: ${mainPaymentId} for Customer: ${customerId}`);

            
            if (invoicesToApplyFee.length > 0) {
                let feeAccount = search.create({
                    type : 'customrecord_abj_mdr_fee_account_map',
                    filters : [
                        ['custrecord_abj_mdrfee_coa_map_pg', 'anyof', paymentMethod]
                    ],
                    columns : [
                        search.createColumn({ name: 'custrecord_abj_mdrfee_coa_map' })
                    ]
                });

                let feeAccountId = null;
                feeAccount.run().each(result => {
                    feeAccountId = result.getValue({ name: 'custrecord_abj_mdrfee_coa_map' });
                    return false; 
                });

                let feePaymentId = createCustomerPayment({
                    customerId: customerId,
                    trandate: parsedDate,
                    memo: "Fee Recon for: " + memoText,
                    bankAccount: feeAccountId,
                    paymentMethod: paymentMethod,
                    invoicesToApply: invoicesToApplyFee,
                    paymentType : 7
                });
                log.debug('Fee Payment Created', `Fee Payment ID: ${feePaymentId} for Customer: ${customerId}`);
            }

        } catch (e) {
            log.error('Reduce Error', e.message);
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

    return { getInputData, map, reduce, summarize };
});