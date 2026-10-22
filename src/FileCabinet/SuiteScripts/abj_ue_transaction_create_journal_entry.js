/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/task', 'N/log', 'N/search','N/record'], (task, log, search, record) => {
    
    const APPROVAL_CONFIG = {
        'salesorder': {
            statusField: 'status', // order status pending fulfillment
            approvedValue : 'pendingbilling'
        },
        'invoice': {
            statusField: 'approvalstatus', // Ubah ke 'status' jika Invoice Anda tidak pakai approval routing
            approvedValue: 2,               // Sesuaikan valuenya jika pakai field 'status'
        }
    };

    const setJournalLine = ({
        jeRec,
        account,
        amount,
        trxId,
        mainProductSegment,
        subProductSegment,
        productSource,
        productTypeSegment,
        enterpriseSegment,
        merchantSegment,
        applicationSegment,
        channelSegment,
        prepaidPostpaidSegment,
        classBillingType,
        itemDescription,
        entity,
        lineSO,
        lineJournal  
    }) => {
        log.debug('setJournalLine', `Processing JE Line for Transaction: ${trxId} | Account: ${account} | Amount: ${amount} | Item Desc : ${itemDescription}`);
        jeRec.selectLine({ sublistId: 'line', line : lineJournal });
        if(account){
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: account });
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: amount });
        }
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_link_transaction', value: trxId });
        if(mainProductSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_main_prod', value: mainProductSegment });
        if(subProductSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_sub_prod', value: subProductSegment });
        if(productSource) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_product_source', value: productSource });
        if(productTypeSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_prod_type', value: productTypeSegment });
        if(enterpriseSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_enterprise', value: enterpriseSegment });
        if(merchantSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_merchant', value: merchantSegment });
        if(applicationSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_applicatio', value: applicationSegment });
        if(channelSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_channel_se', value: channelSegment });
        if(prepaidPostpaidSegment) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'cseg_abj_billing_ty', value: prepaidPostpaidSegment });
        if(classBillingType) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'class', value: classBillingType });
        if(itemDescription) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: itemDescription });
        if(entity) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'entity', value: entity });
        if(lineSO) jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_line_id_so', value: lineSO });
        jeRec.commitLine({ sublistId: 'line' });
    }

    const createReconJournalEntry = ({
        jeRecId,
        startDate,
        pic,
        headerBillingType,
        approved,
        lineItem,
        discountItem,
    }) =>{
        try {
            var jeRec = null;
            if(jeRecId){
                jeRec = record.load({
                    type: record.Type.JOURNAL_ENTRY,
                    id : jeRecId,
                    isDynamic: true
                })
            }else{
                jeRec = record.create({
                    type: record.Type.JOURNAL_ENTRY,
                    isDynamic: true
                });
            }

            // Set JE Header
            jeRec.setValue({ fieldId : 'customform', value : 30})
            if(approved){
                jeRec.setValue({ fieldId: 'approvalstatus', value: 2 }); // 2 = Approved
            }
            if (startDate) {
                jeRec.setValue({ 
                    fieldId: 'trandate', 
                    value: startDate 
                });
            }
            if(pic){
                jeRec.setValue({ 
                    fieldId: 'custbody2', 
                    value: pic
                });
            }
            if(headerBillingType){
                jeRec.setValue({ 
                    fieldId: 'cseg_abj_billing_ty', 
                    value: headerBillingType 
                });
            }
            if(lineItem[0].trxId){
                jeRec.setValue({ 
                    fieldId: 'custbody_abj_so_link', 
                    value: lineItem[0].trxId 
                });
                
            }

            
            // const roundedCreditAmt = Number(Number(amortAmount).toFixed(2));
            
            // const roundedDiscountAmt = (sumDiscounts && sumDiscounts > 0) ? Number(Number(sumDiscounts).toFixed(2)) : 0;
            
            // const roundedDebitAmt = Number((roundedCreditAmt - roundedDiscountAmt).toFixed(2));
            
            log.debug('discountItem[0].itemId', discountItem[0].itemId);

            // let coaDiscount = search.lookupFields({
            //     type: 'discountitem',
            //     id: discountItem[0].itemId,
            //     columns: ['account']
            // });
            const loadDiscountItem = record.load({
                type : 'discountitem',
                id : discountItem[0].itemId
            });
            let coaDiscount = '';
            if(loadDiscountItem){
                coaDiscount = loadDiscountItem.getValue('account');
                log.debug('coaDiscount',coaDiscount)
            }
            let discountAccount = coaDiscount;
            let coaItems = search.create({
                type: 'item',
                filters: [
                    ['internalid', 'anyof', lineItem.map(item => item.itemId)]
                ],
                columns: ['custitem_abj_income_usage_account', 'incomeaccount']
            }).run().getRange({ start: 0, end: lineItem.length });
            let itemAccounts = {};
            coaItems.forEach(item => {
                const itemId = item.id;
                const incomeAccount = item.getValue('incomeaccount');
                const usageAccount = item.getValue('custitem_abj_income_usage_account');
                itemAccounts[itemId] = {
                    incomeAccount: incomeAccount,
                    usageAccount: usageAccount
                };
            });

            let defaultOrder = ['custitem_abj_income_usage_account', 'premiumdiscount','onetimediscount', 'incomeaccount'];

            let lineJournal = 0;
            for(let i = 0; i < lineItem.length; i++){
                const item = lineItem[i];
                log.debug('item', item);
                const itemId = item.itemId;
                const itemAccount = itemAccounts[itemId];
                const amount = item.publishedPrice * item.reconVariance * -1;

                if(item.reconVariance < 0){
                    setJournalLine({
                        jeRec : jeRec, 
                        account : itemAccount.usageAccount,
                        amount : amount,
                        trxId : item.trxId,
                        mainProductSegment : item.mainProductSegment,
                        subProductSegment : item.subProductSegment,
                        productSource : item.productSource,
                        productTypeSegment : item.productTypeSegment,
                        enterpriseSegment : item.enterpriseSegment,
                        merchantSegment : item.merchantSegment,
                        applicationSegment :item.applicationSegment,
                        channelSegment : item.channelSegment,
                        prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                        classBillingType : item.classBillingType,
                        itemDescription : item.itemDescription,
                        entity : item.entity,
                        lineSO : item.lineSO,
                        lineJournal : lineJournal
                    });
                    lineJournal++;
                    if(item.premiumDiscount != 0){
                       setJournalLine({
                            jeRec : jeRec, 
                            account : discountAccount,
                            amount : item.premiumDiscount * item.reconVariance,
                            trxId : item.trxId,
                            mainProductSegment : item.mainProductSegment,
                            subProductSegment : item.subProductSegment,
                            productSource : item.productSource,
                            productTypeSegment : item.productTypeSegment,
                            enterpriseSegment : item.enterpriseSegment,
                            merchantSegment : item.merchantSegment,
                            applicationSegment :item.applicationSegment,
                            channelSegment : item.channelSegment,
                            prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                            classBillingType : item.classBillingType,
                            itemDescription : 'Premium Discount',
                            entity : item.entity,
                            lineSO : item.lineSO,
                            lineJournal : lineJournal
                        }); 
                        lineJournal++;
                    }
                    if(item.oneTimeDiscount != 0){
                       setJournalLine({
                            jeRec : jeRec, 
                            account : discountAccount,
                            amount : item.oneTimeDiscount * item.reconVariance,
                            trxId : item.trxId,
                            mainProductSegment : item.mainProductSegment,
                            subProductSegment : item.subProductSegment,
                            productSource : item.productSource,
                            productTypeSegment : item.productTypeSegment,
                            enterpriseSegment : item.enterpriseSegment,
                            merchantSegment : item.merchantSegment,
                            applicationSegment :item.applicationSegment,
                            channelSegment : item.channelSegment,
                            prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                            classBillingType : item.classBillingType,
                            itemDescription : 'One Time Discount',
                            entity : item.entity,
                            lineSO : item.lineSO,
                            lineJournal : lineJournal
                        }); 
                        lineJournal++;
                    }
                    setJournalLine({
                        jeRec : jeRec, 
                        account : itemAccount.incomeAccount,
                        amount : item.rate * item.reconVariance,
                        trxId : item.trxId,
                        mainProductSegment : item.mainProductSegment,
                        subProductSegment : item.subProductSegment,
                        productSource : item.productSource,
                        productTypeSegment : item.productTypeSegment,
                        enterpriseSegment : item.enterpriseSegment,
                        merchantSegment : item.merchantSegment,
                        applicationSegment :item.applicationSegment,
                        channelSegment : item.channelSegment,
                        prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                        classBillingType : item.classBillingType,
                        itemDescription : item.itemDescription,
                        entity : item.entity,
                        lineSO : item.lineSO,
                        lineJournal : lineJournal,
                    });
                    lineJournal++;
                }else{
                    setJournalLine({
                        jeRec : jeRec, 
                        account : itemAccount.incomeAccount,
                        amount : item.rate * item.reconVariance,
                        trxId : item.trxId,
                        mainProductSegment : item.mainProductSegment,
                        subProductSegment : item.subProductSegment,
                        productSource : item.productSource,
                        productTypeSegment : item.productTypeSegment,
                        enterpriseSegment : item.enterpriseSegment,
                        merchantSegment : item.merchantSegment,
                        applicationSegment :item.applicationSegment,
                        channelSegment : item.channelSegment,
                        prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                        classBillingType : item.classBillingType,
                        itemDescription : item.itemDescription,
                        entity : item.entity,
                        lineSO : item.lineSO,
                        lineJournal : lineJournal,
                    });
                    lineJournal++;
                    if(item.premiumDiscount != 0){
                        setJournalLine({
                            jeRec : jeRec, 
                            account : discountAccount,
                            amount : item.premiumDiscount * item.reconVariance,
                            trxId : item.trxId,
                            mainProductSegment : item.mainProductSegment,
                            subProductSegment : item.subProductSegment,
                            productSource : item.productSource,
                            productTypeSegment : item.productTypeSegment,
                            enterpriseSegment : item.enterpriseSegment,
                            merchantSegment : item.merchantSegment,
                            applicationSegment :item.applicationSegment,
                            channelSegment : item.channelSegment,
                            prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                            classBillingType : item.classBillingType,
                            itemDescription : 'Premium Discount',
                            entity : item.entity,
                            lineSO : item.lineSO,
                            lineJournal : lineJournal,
                        }); 
                        lineJournal++;
                    }
                    if(item.oneTimeDiscount != 0){
                        setJournalLine({
                            jeRec : jeRec, 
                            account : discountAccount,
                            amount : item.oneTimeDiscount * item.reconVariance,
                            trxId : item.trxId,
                            mainProductSegment : item.mainProductSegment,
                            subProductSegment : item.subProductSegment,
                            productSource : item.productSource,
                            productTypeSegment : item.productTypeSegment,
                            enterpriseSegment : item.enterpriseSegment,
                            merchantSegment : item.merchantSegment,
                            applicationSegment :item.applicationSegment,
                            channelSegment : item.channelSegment,
                            prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                            classBillingType : item.classBillingType,
                            itemDescription : 'One Time Discount',
                            entity : item.entity,
                            lineSO : item.lineSO,
                            lineJournal : lineJournal,
                        });
                        lineJournal++; 
                    }
                    setJournalLine({
                        jeRec : jeRec, 
                        account : itemAccount.usageAccount,
                        amount : amount,
                        trxId : item.trxId,
                        mainProductSegment : item.mainProductSegment,
                        subProductSegment : item.subProductSegment,
                        productSource : item.productSource,
                        productTypeSegment : item.productTypeSegment,
                        enterpriseSegment : item.enterpriseSegment,
                        merchantSegment : item.merchantSegment,
                        applicationSegment :item.applicationSegment,
                        channelSegment : item.channelSegment,
                        prepaidPostpaidSegment : item.prepaidPostpaidSegment,
                        classBillingType : item.classBillingType,
                        itemDescription : item.itemDescription,
                        entity : item.entity,
                        lineSO : item.lineSO,
                        lineJournal : lineJournal,
                    });
                    lineJournal++;
                }
            }

            const jeId = jeRec.save();

            return jeId;
        } catch (error) {
            log.error('error create journal entry', error)
            return null;
        }
    }

    const afterSubmit = (context) => {
        log.debug('After Submit Type', context.type);
        if (context.type === context.UserEventType.DELETE) return;

        const rec = context.newRecord;
        const oldRec = context.oldRecord;
        const recType = rec.type;
        const recId = rec.id;

       

        if (!APPROVAL_CONFIG[recType]) return;
        
        const config = APPROVAL_CONFIG[recType];
        log.debug('Approval Config', `Record ID : ${recId}, Record Type: ${recType}, Status Field: ${config.statusField}, Approved Value: ${config.approvedValue}`);

        let oldStatus = null;
        if (oldRec) {
            oldStatus = oldRec.getValue({ fieldId: config.statusField }).toLowerCase().replaceAll(" ", "");
        }

        // let classId = rec.getValue({ fieldId : 'class'});
        let customForm = rec.getValue({ fieldId : 'customform'});

        if(customForm == '112'){
            // RECON JOURNAL
            let lineItem = [];
            let discountItem = [];
            let entity =rec.getValue({ fieldId: 'entity'}); 
            let lineCount = rec.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < lineCount; i++) {
                let itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                let itemText = rec.getSublistText({ sublistId: 'item', fieldId: 'item', line: i });

                let itemType = rec.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                let rate = rec.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
                let publishedPrice = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_published_price', line: i });
                let qty = rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                let reconVariance = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_recon_variance', line: i });
                let premiumDiscount = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_discount_premium', line: i });
                let oneTimeDiscount = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_dis_onetime_pcs', line: i });
                let mainProductSegment = rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_main_prod', line: i });
                let subProductSegment = rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_sub_prod', line: i });
                let productSource = rec.getSublistValue({ sublistId: 'item', fieldId: 'custcol_abj_product_source', line: i });
                let productTypeSegment = rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_prod_type', line: i });
                let enterpriseSegment = rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_enterprise', line: i });
                let merchantSegment = rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_merchant', line: i });
                let applicationSegment =rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_applicatio', line: i });
                let channelSegment =rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_channel_se', line: i }); 
                let prepaidPostpaidSegment =rec.getSublistValue({ sublistId: 'item', fieldId: 'cseg_abj_billing_ty', line: i }); 
                let classBillingType =rec.getSublistValue({ sublistId: 'item', fieldId: 'class', line: i }); 
                let itemDescription =rec.getSublistValue({ sublistId: 'item', fieldId: 'memo', line: i });
                
                let lineSO =rec.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i }); 

                if(itemType == 'Discount'){
                    discountItem.push({
                        itemId : itemId,
                        rate : rate,
                        publishedPrice : publishedPrice,
                        qty : qty,
                        reconVariance : reconVariance,
                        premiumDiscount : premiumDiscount ? Math.abs(premiumDiscount) : '',
                        oneTimeDiscount : premiumDiscount ? Math.abs(oneTimeDiscount) : '',
                        trxId : recId,
                        mainProductSegment : mainProductSegment,
                        subProductSegment : subProductSegment,
                        productSource : productSource,
                        productTypeSegment : productTypeSegment,
                        enterpriseSegment : enterpriseSegment,
                        merchantSegment : merchantSegment,
                        applicationSegment :applicationSegment,
                        channelSegment : channelSegment,
                        prepaidPostpaidSegment : prepaidPostpaidSegment,
                        classBillingType : classBillingType,
                        itemDescription : `${itemText} -  Reconciliation`,
                        entity : entity,
                        lineSO : lineSO
                    });
                }else{
                   lineItem.push({
                        itemId : itemId,
                        rate : rate,
                        publishedPrice : publishedPrice,
                        qty : qty,
                        reconVariance : reconVariance,
                        premiumDiscount : premiumDiscount ? Math.abs(premiumDiscount) : '',
                        oneTimeDiscount : premiumDiscount ? Math.abs(oneTimeDiscount) : '',
                        trxId : recId,
                        mainProductSegment : mainProductSegment,
                        subProductSegment : subProductSegment,
                        productSource : productSource,
                        productTypeSegment : productTypeSegment,
                        enterpriseSegment : enterpriseSegment,
                        merchantSegment : merchantSegment,
                        applicationSegment :applicationSegment,
                        channelSegment : channelSegment,
                        prepaidPostpaidSegment : prepaidPostpaidSegment,
                        classBillingType : classBillingType,
                        itemDescription : `${itemText} -  Reconciliation`,
                        entity : entity,
                        lineSO : lineSO
                    }); 
                }
            }
            const reconJournalEntry = createReconJournalEntry({
                jeRecId : rec.getValue({ fieldId : 'custbody_abj_je_link'}),
                startDate : rec.getValue({ fieldId : 'trandate'}),
                pic : rec.getValue({ fieldId : 'custbody2'}),
                headerBillingType : rec.getValue({ fieldId : 'cseg_abj_billing_ty'}),
                approved : (rec.getValue({ fieldId : config.statusField}) == config.approvedValue),
                lineItem : lineItem,
                discountItem : discountItem
            })
            log.debug('reconJournalEntry', reconJournalEntry);
            
            record.submitFields({
                type: recType,
                id: recId,
                values: {
                    custbody_abj_je_link: reconJournalEntry
                }
            });
            return;

        }
        // log.debug('class id', classId);
        // if(!classId){
        //     log.audit('ignored auto amort class is null', classId);
        //     return;
        // }
        // let allowedClass = [];
        let allowedCustomForm = [
            "132", // Privy - Sales Order Prepaid
            "161", // Privy - Sales Order Postpaid Top Up
            "187" // Privy - Invoice (Payment Gateway)
        ];
        // const loadSearchClass = search.load({ id : 'customsearch_abj_billing_type_class'});
        // loadSearchClass.run().each(function(result) {
            
        //     allowedClass.push(result.id);
            
        //     // Option B: If you need a specific column value instead, use getValue:
        //     // allowedClass.push(result.getValue({ name: 'column_name' }));
            
        //     return true; // Return true to continue iterating through all results
        // });
        // log.debug('allowedClass', allowedClass); 
        // if(!allowedClass.includes(classId)){
        //     log.audit('ignored auto amort class', classId);
        //     return;
        // }
        log.debug('allowedCustomForm', allowedCustomForm); 
        if(!allowedCustomForm.includes(customForm)){
            log.audit('ignored auto amort customform', customForm);
            return;
        }
        
        // log.audit('allowed auto amort class', classId);
        // return;
        

        let newDbStatus = null;

        try {
            const lookup = search.lookupFields({
                type: recType,
                id: recId,
                columns: [config.statusField]
            });
            log.debug('Status', `Lookup Result: ${JSON.stringify(lookup)}`);
            

            const rawDbValue = lookup[config.statusField];
            if (Array.isArray(rawDbValue) && rawDbValue.length > 0) {
                newDbStatus = rawDbValue[0].value?.toLowerCase().replaceAll(" ", "");
            } else {
                newDbStatus = rawDbValue?.toLowerCase().replaceAll(" ", "");
            }
        } catch (e) {
            log.error('Lookup Status Error', e);
            newDbStatus = rec.getValue({ fieldId: config.statusField })?.toLowerCase().replaceAll(" ", "");
        }

        log.debug('old status', oldStatus);
        log.debug('new status', newDbStatus);

        let approved = (newDbStatus == config.approvedValue) && (newDbStatus != oldStatus);
        log.debug('approved', approved);
        if (approved) {
            try {
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_abj_mr_trx_auto_create_je',
                    // deploymentId: 'customdeploy_my_mr_process',
                    params: {
                        custscript_abj_rec_id: recId
                    }
                });

                const taskId = mrTask.submit();
                log.audit('Map/Reduce Triggered', `Task ID: ${taskId} | Record ID: ${recId}`);

            } catch (error) {
                log.error({
                    title: `Failed to trigger Map/Reduce for ID: ${recId}`,
                    details: error
                });
            }
        }
    };

    return { afterSubmit };
});