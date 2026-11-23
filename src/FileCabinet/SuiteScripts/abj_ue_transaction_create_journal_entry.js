/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/task', 'N/log', 'N/search', 'N/record'], (task, log, search, record) => {
    
    const APPROVAL_CONFIG = {
        'salesorder': {
            statusField: 'status',
            approvedValue: 'pendingbilling'
        },
        'invoice': {
            statusField: 'approvalstatus',
            approvedValue: 2
        }
    };

    const setJournalLine = (params) => {
        const { jeRec, account, amount, lineJournal, itemDescription } = params;
        log.debug('setJournalLine', `Processing JE Line for Transaction: ${params.trxId} | Account: ${account} | Amount: ${amount} | Item Desc : ${itemDescription}`);
        
        jeRec.selectLine({ sublistId: 'line', line: lineJournal });
        if (account) {
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: account });
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: amount });
        }
        
        const fieldMappings = {
            'custcol_abj_link_transaction': params.trxId,
            'cseg_abj_main_prod': params.mainProductSegment,
            'cseg_abj_sub_prod': params.subProductSegment,
            'custcol_abj_product_source': params.productSource,
            'cseg_abj_prod_type': params.productTypeSegment,
            'cseg_abj_enterprise': params.enterpriseSegment,
            'cseg_abj_merchant': params.merchantSegment,
            'cseg_abj_applicatio': params.applicationSegment,
            'cseg_abj_channel_se': params.channelSegment,
            'cseg_abj_billing_ty': params.prepaidPostpaidSegment,
            'class': params.classBillingType,
            'memo': itemDescription,
            'entity': params.entity,
            'custcol_abj_line_id_so': params.lineSO
        };

        for (const [fieldId, value] of Object.entries(fieldMappings)) {
            if (value) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId, value });
        }
        
        jeRec.commitLine({ sublistId: 'line' });
    };

    const createJournalEntry = (params) => {
        const { 
            jeRecId, 
            customFormId, // Opsional: Kosongkan jika ingin pakai form Standard
            startDate, 
            pic, 
            headerBillingType, 
            approved, 
            journalLines, // Array of object berisi data per baris yang sudah dimapping
            soLinkId,
            memo,
            currency
        } = params;

        try {
            let jeRec = jeRecId 
                ? record.load({ type: record.Type.JOURNAL_ENTRY, id: jeRecId, isDynamic: true })
                : record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });

            
            if (customFormId) jeRec.setValue({ fieldId: 'customform', value: customFormId });
            if (approved) jeRec.setValue({ fieldId: 'approvalstatus', value: 2 }); 
            if (startDate) jeRec.setValue({ fieldId: 'trandate', value: startDate });
            if (pic) jeRec.setValue({ fieldId: 'custbody2', value: pic });
            if (headerBillingType) jeRec.setValue({ fieldId: 'cseg_abj_billing_ty', value: headerBillingType });
            if (soLinkId) jeRec.setValue({ fieldId: 'custbody_abj_so_link', value: soLinkId });
            if (memo) jeRec.setValue({ fieldId: 'memo', value: memo });
            if (currency) jeRec.setValue({ fieldId: 'currency', value: currency });

            let lineJournal = 0;
            for (const line of journalLines) {
                setJournalLine({ ...line, jeRec, lineJournal });
                lineJournal++;
            }

            return jeRec.save();
        } catch (error) {
            log.error('Error create journal entry blueprint', error);
            return null;
        }
    };

    const createReconJournalEntry = ({
        jeRecId, startDate, pic, headerBillingType, approved, lineItem, discountItem
    }) => {
        try {
            let jeRec = jeRecId 
                ? record.load({ type: record.Type.JOURNAL_ENTRY, id: jeRecId, isDynamic: true })
                : record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });

            // Set JE Header
            jeRec.setValue({ fieldId: 'customform', value: 30 });
            if (approved) jeRec.setValue({ fieldId: 'approvalstatus', value: 2 }); // 2 = Approved
            if (startDate) jeRec.setValue({ fieldId: 'trandate', value: startDate });
            if (pic) jeRec.setValue({ fieldId: 'custbody2', value: pic });
            if (headerBillingType) jeRec.setValue({ fieldId: 'cseg_abj_billing_ty', value: headerBillingType });
            if (lineItem[0]?.trxId) jeRec.setValue({ fieldId: 'custbody_abj_so_link', value: lineItem[0].trxId });

            // TO DO : Handle discountItem if needed, currently only lineItem is processed for journal lines.
            let discountAccount = '';
            // if (discountItem.length > 0) {
            //     log.debug('Discount Items Present', discountItem);
            //     const loadDiscountItem = record.load({ type: 'discountitem', id: discountItem[0].itemId });
            //     discountAccount = loadDiscountItem ? loadDiscountItem.getValue('account') : '';
            // }
            
            let coaItems = search.create({
                type: 'item',
                filters: [['internalid', 'anyof', lineItem.map(item => item.itemId)]],
                columns: ['custitem_abj_income_usage_account', 'incomeaccount', 'custitem_abj_reconciliation_account']
            }).run().getRange({ start: 0, end: lineItem.length });
            
            let itemAccounts = {};
            coaItems.forEach(item => {
                let reconciliationAccount = item.getValue('custitem_abj_reconciliation_account');
                itemAccounts[item.id] = {
                    incomeAccount: reconciliationAccount,
                    usageAccount: item.getValue('custitem_abj_income_usage_account'),
                    discountAccount : reconciliationAccount,
                };
            });

            let lineJournal = 0;

            for (const item of lineItem) {
                const itemAccount = itemAccounts[item.itemId];
                const baseAmount = item.finalPrice * item.reconVariance;
                const premiumDiscountAmount = item.premiumDiscount * item.reconVariance;
                const oneTimeDiscountAmount = item.oneTimeDiscount * item.reconVariance;
                // const incomeAmount = item.rate * item.reconVariance;
                const incomeAmount = (baseAmount + oneTimeDiscountAmount) * -1;
                
                const addLine = (account, amount, customDesc = item.itemDescription) => {
                    setJournalLine({ ...item, jeRec, account, amount, itemDescription: customDesc, lineJournal });
                    lineJournal++;
                };

                const linesToProcess = [];

                if (item.reconVariance < 0) {
                    linesToProcess.push({ account: itemAccount.usageAccount, amount: baseAmount });
                    // if (item.premiumDiscount) linesToProcess.push({ account: discountAccount, amount: premiumDiscountAmount, desc: 'Premium Discount' });
                    if (item.oneTimeDiscount) linesToProcess.push({ account: item.discountAccount, amount: oneTimeDiscountAmount, desc: 'One Time Discount' });
                    linesToProcess.push({ account: itemAccount.incomeAccount, amount: incomeAmount });
                } else {
                    linesToProcess.push({ account: itemAccount.incomeAccount, amount: incomeAmount });
                    // if (item.premiumDiscount) linesToProcess.push({ account: discountAccount, amount: premiumDiscountAmount, desc: 'Premium Discount' });
                    if (item.oneTimeDiscount) linesToProcess.push({ account: item.discountAccount, amount: oneTimeDiscountAmount, desc: 'One Time Discount' });
                    linesToProcess.push({ account: itemAccount.usageAccount, amount: baseAmount });
                }

                linesToProcess.forEach(line => addLine(line.account, line.amount, line.desc));
            }

            return jeRec.save();
        } catch (error) {
            log.error('Error create journal entry', error);
            return null;
        }
    };

    const getCOAItems = (items) =>{
        let coaItems = search.create({
            type: 'item',
            filters: [['internalid', 'anyof', items.map(item => item.itemId)]],
            columns: ['custitem_abj_income_usage_account', 'incomeaccount', 'custitem_abj_reconciliation_account', 'custitem_abj_invoice_pg_coa']
        }).run().getRange({ start: 0, end: items.length });
        
        let itemAccounts = {};
        coaItems.forEach(item => {
            let reconAcc = item.getValue('custitem_abj_reconciliation_account');
            itemAccounts[item.id] = {
                incomeAccount: item.getValue('incomeaccount'),
                reconAccount : reconAcc,
                usageAccount: item.getValue('custitem_abj_income_usage_account'),
                discountAccount: reconAcc,
                pgAccount : item.getValue('custitem_abj_invoice_pg_coa')
            };
        });

        return itemAccounts;
    }

    const getLineItemData = (rec) =>{
        let extractedItems = [];
        let discountItems = [];
        let lineCount = rec.getLineCount({ sublistId: 'item' });
        let entity = rec.getValue({ fieldId: 'entity' }); 
        for (let i = 0; i < lineCount; i++) {
            let itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
            if (!itemId) continue; // Skip baris kosong

            let itemType = rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
            let baseData = {
                itemId: itemId,
                rate: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i }) || 0,
                finalPrice: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_final_price', line: i }) || 0,
                reconVariance: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_recon_variance', line: i }) || 0,
                oneTimeDiscount: Math.abs(rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_dis_onetime_pcs', line: i }) || 0),
                trxId: rec.id,
                mainProductSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_main_prod', line: i }),
                subProductSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_sub_prod', line: i }),
                productSource: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_product_source', line: i }),
                productTypeSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_prod_type', line: i }),
                enterpriseSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_enterprise', line: i }),
                merchantSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_merchant', line: i }),
                applicationSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_applicatio', line: i }),
                channelSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_channel_se', line: i }), 
                prepaidPostpaidSegment: rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_billing_ty', line: i }), 
                classBillingType: rec.getSublistValue({ sublistId: 'item', fieldId: 'class', line: i }), 
                itemText: rec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }),
                entity: entity,
                lineSO: rec.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i }),
                amount: rec.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i }),
            };

            if (itemType === 'Discount') {
                discountItems.push(baseData);
            } else {
                extractedItems.push(baseData);
            }
        }

        return { extractedItems, discountItems}
    }

    const afterSubmit = (context) => {
        log.debug('After Submit Type', context.type);
        if (context.type === context.UserEventType.DELETE) return;

        const rec = context.newRecord;
        const oldRec = context.oldRecord;
        const recType = rec.type;
        const recId = rec.id;
        let memoHeader = '';

        if (!APPROVAL_CONFIG[recType]) return;
        const config = APPROVAL_CONFIG[recType];
        
        let customForm = rec.getValue({ fieldId: 'customform' });
        let documentStatus = rec.getValue({ fieldId: 'custbody_abj_document_status' });
        let oldStatus = oldRec ? oldRec.getValue({ fieldId: config.statusField })?.toString().toLowerCase().replaceAll(" ", "") : null;
        let newDbStatus = null;

        try {
            const lookup = search.lookupFields({ type: recType, id: recId, columns: [config.statusField] });
            const rawDbValue = lookup[config.statusField];
            newDbStatus = Array.isArray(rawDbValue) && rawDbValue.length > 0 
                ? rawDbValue[0].value?.toString().toLowerCase().replaceAll(" ", "") 
                : rawDbValue?.toString().toLowerCase().replaceAll(" ", "");
        } catch (e) {
            log.error('Lookup Status Error', e);
            newDbStatus = rec.getValue({ fieldId: config.statusField })?.toString().toLowerCase().replaceAll(" ", "");
        }

        const approvedVal = config.approvedValue.toString().toLowerCase().replaceAll(" ", "");
        const isNowApproved = (newDbStatus === approvedVal);
        const justApproved = isNowApproved && (newDbStatus !== oldStatus);

        log.debug('Approval Status Details', `Old: ${oldStatus} | New: ${newDbStatus} | IsApproved: ${isNowApproved}`);

        // RECON JOURNAL (Custom Form 112) ubah ke 100 (punya invoice)
        if (customForm == '100' || customForm == '187') {
            if (!isNowApproved) {
                log.audit('Skipping JE Creation', `Transaction ${recId} is not approved yet.`);
                return;
            }

            // =====================================================================
            // 1. KUMPULKAN DATA LINE ITEM (HANYA 1 KALI PERULANGAN)
            // =====================================================================
            let lineItemData = getLineItemData(rec);
            let extractedItems = lineItemData.extractedItems;
            let discountItems = lineItemData.discountItems;       
            let soLinkId = recId; // Asumsi link ke SO
            if (extractedItems.length === 0) return;

            // =====================================================================
            // 2. MAPPING DATA BERDASARKAN CUSTOM FORM
            // =====================================================================
            let journalLinesToSubmit = [];
            let targetCustomFormId = null; 

            // --- LOGIKA FORM 100 ---
            if (customForm == '100') {
                targetCustomFormId = 30; // Set form 30
                
                // Filter tambahan khusus form 100: variance tidak boleh 0
                let validReconItems = extractedItems.filter(item => item.reconVariance !== 0);
                if (validReconItems.length === 0) return;

                // Ambil COA
                let itemAccounts = getCOAItems(validReconItems);

                // Map Debit/Credit Form 100
                for (const item of validReconItems) {
                    const itemAcc = itemAccounts[item.itemId];
                    const baseAmount = item.finalPrice * item.reconVariance;
                    const oneTimeDiscountAmount = item.oneTimeDiscount * item.reconVariance;
                    const incomeAmount = (baseAmount + oneTimeDiscountAmount) * -1;
                    const itemDesc = `${item.itemText} - Reconciliation`;

                    const createLine = (acc, amt, desc, eType = 'debit') => {
                        journalLinesToSubmit.push({ ...item, account: acc, amount: amt, itemDescription: desc || itemDesc, entryType: eType });
                    };

                    if (item.reconVariance < 0) {
                        createLine(itemAcc.usageAccount, baseAmount, itemDesc);
                        if (item.oneTimeDiscount) createLine(itemAcc.discountAccount, oneTimeDiscountAmount, 'One Time Discount');
                        createLine(itemAcc.reconAcc, incomeAmount, itemDesc);
                    } else {
                        createLine(itemAcc.reconAcc, incomeAmount, itemDesc);
                        if (item.oneTimeDiscount) createLine(itemAcc.discountAccount, oneTimeDiscountAmount, 'One Time Discount');
                        createLine(itemAcc.usageAccount, baseAmount, itemDesc);
                    }
                }
            } 
            
            if (customForm == '187') {
                targetCustomFormId = null; // Standard form (tidak diset)
                let itemAccounts = getCOAItems(extractedItems);
                memoHeader = 'Invoice PG Journal';
                
                // Map Debit/Credit Form 187 (Menggunakan semua extractedItems)
                for (const item of extractedItems) {
                    const itemAcc = itemAccounts[item.itemId];
                    let rateAmount = item.amount;
                    const itemDesc = `${item.itemText}`;

                    const createLine = (acc, amt, desc, eType = 'debit') => {
                        journalLinesToSubmit.push({ ...item, account: acc, amount: amt, itemDescription: desc || itemDesc, entryType: eType });
                    };

                    if(rateAmount > 0){
                        createLine(itemAcc.incomeAccount, rateAmount, itemDesc);
                        createLine(itemAcc.pgAccount, rateAmount * -1, itemDesc, 'credit');
                    }

                }
            }

            if (journalLinesToSubmit.length > 0) {
                const jeId = createJournalEntry({ // Fungsi blueprint dari jawaban sebelumnya
                    jeRecId: rec.getValue({ fieldId: 'custbody_abj_je_link' }),
                    customFormId: targetCustomFormId, 
                    startDate: rec.getValue({ fieldId: 'trandate' }),
                    pic: rec.getValue({ fieldId: 'custbody2' }),
                    headerBillingType: rec.getValue({ fieldId: 'cseg_abj_billing_ty' }),
                    approved: isNowApproved,
                    journalLines: journalLinesToSubmit,
                    soLinkId: soLinkId,
                    memo : memoHeader,
                    currency : rec.getValue({ fieldId: 'currency' })
                });
                
                if (jeId) {
                    record.submitFields({ type: recType, id: recId, values: { custbody_abj_je_link: jeId } });
                }
            }
            return;
        }

        // JOURNAL AMORT : MAP/REDUCE
        const allowedCustomForm = [
            "195", // Privy - Sales Order Prepaid
            "196", // Privy - Sales Order Postpaid Top Up
            "187", // Privy - Invoice (Payment Gateway)
            "189", // Privy - Sales Order Prepaid By Pass
            "191" // Privy - Sales Order Prepaid Without Top Up
        ];
        if (!allowedCustomForm.includes(customForm)) {
            log.audit('Ignored Auto Amort CustomForm', customForm);
            return;
        }

        let isBilled = documentStatus == "8";
        if(customForm == "191" && isBilled == false) {
            log.audit('Ignored Auto Amort CustomForm 191', 'Sales Order Document Status is not Billed');
            return;
        }

        if (isNowApproved) {
            try {
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_abj_mr_trx_auto_create_je',
                    params: { custscript_abj_rec_id: recId }
                });
                const taskId = mrTask.submit();
                log.audit('Map/Reduce Triggered', `Task ID: ${taskId} | Record ID: ${recId}`);
                const mrTask2 = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_abj_mr_trx_auto_create_je_m',
                    params: { custscript_abj_trx_je_montly_rec_id : recId }
                });
                const taskId2 = mrTask2.submit();
                log.audit('Map/Reduce 2 Triggered', `Task ID: ${taskId2} | Record ID: ${recId}`);
            } catch (error) {
                log.error({ title: `Failed to trigger Map/Reduce for ID: ${recId}`, details: error });
            }
        }
    };

    return { afterSubmit };
});