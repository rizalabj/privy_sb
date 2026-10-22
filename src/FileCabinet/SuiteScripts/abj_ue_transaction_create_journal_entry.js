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

            const loadDiscountItem = record.load({ type: 'discountitem', id: discountItem[0].itemId });
            let discountAccount = loadDiscountItem ? loadDiscountItem.getValue('account') : '';
            
            let coaItems = search.create({
                type: 'item',
                filters: [['internalid', 'anyof', lineItem.map(item => item.itemId)]],
                columns: ['custitem_abj_income_usage_account', 'incomeaccount']
            }).run().getRange({ start: 0, end: lineItem.length });
            
            let itemAccounts = {};
            coaItems.forEach(item => {
                itemAccounts[item.id] = {
                    incomeAccount: item.getValue('incomeaccount'),
                    usageAccount: item.getValue('custitem_abj_income_usage_account')
                };
            });

            let lineJournal = 0;

            for (const item of lineItem) {
                const itemAccount = itemAccounts[item.itemId];
                const baseAmount = item.publishedPrice * item.reconVariance * -1;
                const incomeAmount = item.rate * item.reconVariance;
                
                // Helper untuk men-generate line
                const addLine = (account, amount, customDesc = item.itemDescription) => {
                    setJournalLine({ ...item, jeRec, account, amount, itemDescription: customDesc, lineJournal });
                    lineJournal++;
                };

                const linesToProcess = [];

                if (item.reconVariance < 0) {
                    linesToProcess.push({ account: itemAccount.usageAccount, amount: baseAmount });
                    if (item.premiumDiscount) linesToProcess.push({ account: discountAccount, amount: item.premiumDiscount * item.reconVariance, desc: 'Premium Discount' });
                    if (item.oneTimeDiscount) linesToProcess.push({ account: discountAccount, amount: item.oneTimeDiscount * item.reconVariance, desc: 'One Time Discount' });
                    linesToProcess.push({ account: itemAccount.incomeAccount, amount: incomeAmount });
                } else {
                    linesToProcess.push({ account: itemAccount.incomeAccount, amount: incomeAmount });
                    if (item.premiumDiscount) linesToProcess.push({ account: discountAccount, amount: item.premiumDiscount * item.reconVariance, desc: 'Premium Discount' });
                    if (item.oneTimeDiscount) linesToProcess.push({ account: discountAccount, amount: item.oneTimeDiscount * item.reconVariance, desc: 'One Time Discount' });
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

    const afterSubmit = (context) => {
        log.debug('After Submit Type', context.type);
        if (context.type === context.UserEventType.DELETE) return;

        const rec = context.newRecord;
        const oldRec = context.oldRecord;
        const recType = rec.type;
        const recId = rec.id;

        if (!APPROVAL_CONFIG[recType]) return;
        const config = APPROVAL_CONFIG[recType];
        
        let customForm = rec.getValue({ fieldId: 'customform' });
        let oldStatus = oldRec ? oldRec.getValue({ fieldId: config.statusField })?.toString().toLowerCase().replaceAll(" ", "") : null;
        let newDbStatus = null;

        // Sentralisasi Lookup Status
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

        // LOGIKA RECON JOURNAL (Custom Form 112)
        if (customForm == '112') {
            if (!isNowApproved) {
                log.audit('Skipping Recon JE', `Transaction ${recId} is not approved yet.`);
                return;
            }

            let lineItem = [];
            let discountItem = [];
            let entity = rec.getValue({ fieldId: 'entity' }); 
            let lineCount = rec.getLineCount({ sublistId: 'item' });
            
            for (let i = 0; i < lineCount; i++) {
                let itemType = rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                let premiumDiscount = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_discount_premium', line: i });
                let oneTimeDiscount = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_dis_onetime_pcs', line: i });
                let itemText = rec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });

                let lineData = {
                    itemId: rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }),
                    rate: rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i }),
                    publishedPrice: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_published_price', line: i }),
                    qty: rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }),
                    reconVariance: rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_recon_variance', line: i }),
                    premiumDiscount: premiumDiscount ? Math.abs(premiumDiscount) : '',
                    oneTimeDiscount: oneTimeDiscount ? Math.abs(oneTimeDiscount) : '',
                    trxId: recId,
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
                    itemDescription: `${itemText} - Reconciliation`,
                    entity: entity,
                    lineSO: rec.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i })
                };

                if (itemType === 'Discount') {
                    discountItem.push(lineData);
                } else {
                    lineItem.push(lineData);
                }
            }

            const reconJournalEntry = createReconJournalEntry({
                jeRecId: rec.getValue({ fieldId: 'custbody_abj_je_link' }),
                startDate: rec.getValue({ fieldId: 'trandate' }),
                pic: rec.getValue({ fieldId: 'custbody2' }),
                headerBillingType: rec.getValue({ fieldId: 'cseg_abj_billing_ty' }),
                approved: isNowApproved,
                lineItem: lineItem,
                discountItem: discountItem
            });
            
            if (reconJournalEntry) {
                record.submitFields({
                    type: recType,
                    id: recId,
                    values: { custbody_abj_je_link: reconJournalEntry }
                });
            }
            return;
        }

        // LOGIKA MAP/REDUCE (Custom Form lainnya)
        const allowedCustomForm = ["132", "161", "187"];
        if (!allowedCustomForm.includes(customForm)) {
            log.audit('Ignored Auto Amort CustomForm', customForm);
            return;
        }

        if (justApproved) {
            try {
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_abj_mr_trx_auto_create_je',
                    params: { custscript_abj_rec_id: recId }
                });
                const taskId = mrTask.submit();
                log.audit('Map/Reduce Triggered', `Task ID: ${taskId} | Record ID: ${recId}`);
            } catch (error) {
                log.error({ title: `Failed to trigger Map/Reduce for ID: ${recId}`, details: error });
            }
        }
    };

    return { afterSubmit };
});