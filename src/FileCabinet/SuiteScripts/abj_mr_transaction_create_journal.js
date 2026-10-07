/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/format'], (record, search, runtime, format) => {

    // 5. SO - Jurnal Amortization   segment di line jurnal diset, segment2 nya  : 
    // Main Product Segment, Sub Product Segment, Product Type Segment, Enterprise Segment, 
    // Merchant Segment, Application Segment, Channel Segment, Prepaid/Postpaid Segment, 
    // Class/Billing Type, dan Item Description ke memo line di jurnal
    const setJournalLine = ({
        jeRec,
        debitAccount,
        creditAccount,
        amortAmount,
        trxId,
        daysToAmortize,
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
        entity  
    }) => {
        jeRec.selectNewLine({ sublistId: 'line' });
        if(debitAccount){
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: debitAccount });
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: amortAmount });
        }
        if(creditAccount){
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: creditAccount });
            jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: amortAmount });
        }
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_link_transaction', value: trxId });
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_days_to_amortize', value: (Number(daysToAmortize) - 1) });
        jeRec.setCurrentSublistValue({ sublistId: 'line', fieldId: 'custcol_abj_days_to_amortize', value: (Number(daysToAmortize) - 1) });
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
        jeRec.commitLine({ sublistId: 'line' });
    }

    const createJournalEntry = ({
        startDate,
        pic,
        headerBillingType,
        debitAccount,
        amortAmount,
        trxId,
        daysToAmortize,
        creditAccount,
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
        sumDiscounts,
        approved
    }) =>{
        try {
            const jeRec = record.create({
                type: record.Type.JOURNAL_ENTRY,
                isDynamic: true
            });

            // Set JE Header
            jeRec.setValue({ fieldId: 'customform', value: 183 }); // 2 = custom form
            if(approved){
                jeRec.setValue({ fieldId: 'approvalstatus', value: 2 }); // 2 = Approved
            }
            if (startDate) {
                jeRec.setValue({ 
                    fieldId: 'trandate', 
                    value: format.parse({ value: startDate, type: format.Type.DATE }) 
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

            

            // Add Debit Line
            setJournalLine({ 
                jeRec : jeRec,
                debitAccount : debitAccount,
                amortAmount : Number(amortAmount) - Number(sumDiscounts),
                daysToAmortize : daysToAmortize,
                trxId : trxId,
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
                itemDescription : itemDescription,
                entity : entity
            });

            
            
            // Add Credit Line
            setJournalLine({ 
                jeRec : jeRec,
                creditAccount : creditAccount,
                amortAmount : amortAmount,
                daysToAmortize : daysToAmortize,
                trxId : trxId,
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
                itemDescription : itemDescription,
                entity : entity
            });

            // add discount line if sumDiscounts > 0 (Debit to debitAccount )
            if(sumDiscounts && sumDiscounts > 0){
                setJournalLine({ 
                    jeRec : jeRec,
                    debitAccount : debitAccount,
                    amortAmount : Number(sumDiscounts),
                    daysToAmortize : daysToAmortize,
                    trxId : trxId,
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
                    itemDescription : itemDescription,
                    entity : entity
                });
            }
            

            const jeId = jeRec.save();

            return jeId;
        } catch (error) {
            log.error('error create journal entry', error)
            return null;
        }
    }

    const createAmortizationRevenueDefinition = ({
        nameMemorize,
        trxType,
        repeatPer,
        numRemaining,
        numAmor,
        nexDate,
        linkTrx,
        item,
        line,
        sourceTrx,
        startDate,
        endDate,
        timePeriod  
    }) =>{
        try {
            const customMemRec = record.create({ type: 'customrecord_abj_privy_amor_rev_def' });
            // customMemRec.setValue({ fieldId: 'custrecord_je_template', value: jeId });
            customMemRec.setValue({ fieldId: 'name', value: nameMemorize });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_trx_type', value: trxType });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_repeat_per', value: repeatPer });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_num_remain', value: numRemaining });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_num_amor', value: numAmor });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_source_transaction', value: sourceTrx});
            if (startDate) {
                customMemRec.setValue({ 
                    fieldId: 'custrecord_abj_privy_start_date_rev_amor', 
                    value: format.parse({ value: startDate, type: format.Type.DATE }) 
                });
            }
            if(endDate){
                customMemRec.setValue({ 
                    fieldId: 'custrecord_abj_privy_end_date_rev_amor',
                    value: format.parse({ value: endDate, type: format.Type.DATE })
                });
            }
            // customMemRec.setValue({ fieldId: 'custrecord_abj_privy_end_date_rev_amor', value: endDate });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_timeperiod', value: timePeriod });
            if (nexDate) {
                log.debug('nextDate',nexDate);
                customMemRec.setValue({ 
                    fieldId: 'custrecord_abj_privy_amor_rev_next_date', 
                    value: format.parse({ value: nexDate, type: format.Type.DATE }) 
                });
            }
            // customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_next_date', value: nexDate });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_def_link_t', value: linkTrx });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_item', value: item });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_order_line', value: line });
            customMemRec.setValue({ fieldId: 'custrecord_abj_privy_amor_rev_def', value: false });
            customMemRec.setValue({ fieldId: 'isinactive', value: false });
            // ... set next date, frequency, remaining count ...
            const memTrxId = customMemRec.save();
            return memTrxId;
        } catch (error) {
            log.error('error createAmortizationRevenueDefinition', error)
            return null;
        }
    }

    const checkStartDate = (startDate) => {
        if (!startDate) {
            return false;
        }

        // 1. Dapatkan HARI INI spesifik di zona waktu Jakarta (Format: YYYY-MM-DD)
        const jakartaFormatter = new Intl.DateTimeFormat('en-CA', { 
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const todayJakartaStr = jakartaFormatter.format(new Date()); 

        // 2. Ubah input startDate menjadi Date Object (jika asalnya dari string)
        const startDateObj = typeof startDate === 'string' 
            ? format.parse({ value: startDate, type: format.Type.DATE }) 
            : startDate;

        // 3. Ekstrak YYYY-MM-DD dari startDate tanpa konversi zona waktu lagi!
        // Gunakan method lokal Date agar tidak bergeser gara-gara offset NetSuite
        const year = startDateObj.getFullYear();
        const month = String(startDateObj.getMonth() + 1).padStart(2, '0');
        const day = String(startDateObj.getDate()).padStart(2, '0');
        const startDateStr = `${year}-${month}-${day}`; 

        // 4. Bandingkan string murni (contoh: "2026-10-05" <= "2026-10-06")
        return startDateStr <= todayJakartaStr; 
    }

    const getInputData = () => {
        // 1. Receive params rec id and rec type from Script Deployment parameters
        const scriptObj = runtime.getCurrentScript();
        const recId = scriptObj.getParameter({ name: 'custscript_abj_rec_id' }); 
        const recType = scriptObj.getParameter({ name: 'custscript_abj_rec_type' }) || search.Type.SALES_ORDER;

        if (!recId) {
            log.error('Missing Parameter', 'Record ID is required to process.');
            return []; // Return empty array to stop processing gracefully
        }

        log.debug('Input Data Params', `Processing Record ID: ${recId} | Type: ${recType}`);

        // 2. Load the saved search
        let searchData = search.load({
            id: 'customsearch505'
        });

        // 3. Add the internal ID filter dynamically so it only runs for the specific record
        searchData.filters.push(
            search.createFilter({
                name: 'internalid',
                operator: search.Operator.ANYOF,
                values: recId
            })
        );

        return searchData;
    };

    const map = (context) => {
        try {
            const searchResult = JSON.parse(context.value);
            const trxId = searchResult.id;
            const values = searchResult.values;
            log.debug('values', values);
            let recordType = values.recordtype;
            const lineNum = values.line;
            const item = values.item.value;
            const itemName = values.item.text;
            const docNo = values.tranid;


            // Extract Line Values
            let amount = parseFloat(values.amount) || 0;
            // const totalAfterOneTimeDiscount = values.custcol_abj_total_after_1time_disc || 0;
            // if(totalAfterOneTimeDiscount && totalAfterOneTimeDiscount > 0){
            //     amount = totalAfterOneTimeDiscount;
            // }

            let totalDiscoutPremium = Math.abs(parseFloat(values.custcol_abj_total_discount_premium) || 0);
            let oneTimeDiscount = Math.abs(parseFloat(values.custcol_abj_one_time_discount) || 0);

            let sumDiscounts = (Math.abs(totalDiscoutPremium) + Math.abs(oneTimeDiscount)) / daysToAmortize;
            const daysToAmortize = values.custcol_abj_days_to_amortize || 1;
            const billingType = values['class'].value;
            const startDate = values.custcol_abj_billing_start_date;
            // const startDate = values.custcol_abj_agreement_start_date;
            const endDate = values.custcol_abj_billing_end_date;
            // const endDate = values.custcol_abj_agreement_end_date;
            let nextDateString = '';
            if(startDate){
                let startDateDate = typeof startDate === 'string' ? format.parse({ value: startDate, type: format.Type.DATE }) : new Date(startDate);
                let nextDate = new Date(startDateDate);
                nextDate.setDate(nextDate.getDate() + 1);
    
                // 4. (Opsional) Format kembali ke string jika diperlukan oleh NetSuite
                nextDateString = format.format({ value: nextDate, type: format.Type.DATE });
                log.debug('startDate',startDate);
                log.debug('nextDateString',nextDateString);

            }
            const pic= values.custbody2.value;
            let headerBillingType = values.class.value;
            const amortAmount = amount / daysToAmortize;
            const debitAccount = values['custrecord_abj_rev_rec_account.class'].value;
            const creditAccount = values['custitem_abj_income_usage_account.item'].value;
            const mainProductSegment = values['line.cseg_abj_main_prod'].value;
            const subProductSegment = values['line.cseg_abj_sub_prod'].value;
            const productSource = values['custcol_abj_product_source'].value;
            const productTypeSegment = values['line.cseg_abj_prod_type'].value;
            const enterpriseSegment = values['line.cseg_abj_enterprise'].value;
            const merchantSegment = values['line.cseg_abj_merchant'].value;
            const applicationSegment = values['line.cseg_abj_applicatio'].value;
            const channelSegment = values['line.cseg_abj_channel_se'].value;
            const prepaidPostpaidSegment = values['line.cseg_abj_billing_ty'].value;
            const classBillingType = billingType;
            const itemDescription = values.memo;
            const entity = values.entity ? values.entity.value : null;

            headerBillingType = prepaidPostpaidSegment;
            const approved = checkStartDate(startDate); // start date <= today, then approved, else pending approval. You can implement this logic based on your requirements.

            log.debug('Processing Line', `SO: ${trxId} | Line: ${lineNum} | Debit Amount: ${amortAmount}`);

            // 3. Create the Journal Entry
            const jeId = createJournalEntry({
                startDate,
                amortAmount,
                billingType,
                creditAccount,
                daysToAmortize,
                debitAccount,
                headerBillingType,
                pic,
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
                sumDiscounts,
                approved
            })
            log.debug('Journal Entry Created', `JE ID: ${jeId} for SO Line: ${lineNum}`);

            // 4. Create Memorized Transaction (Workaround required)
            // SuiteScript DOES NOT have an API to create native Memorized Transactions.
            // You will need to create a custom record here that acts as your Memorized JE queue, 
            // OR script the creation of all future JEs directly.
            let nameMemorize = `Rev Rec ${docNo} ${itemName} ${amount} ${startDate} ${endDate} ${daysToAmortize}`; 
            let memTrxId = createAmortizationRevenueDefinition({
                nameMemorize : nameMemorize,
                trxType : 1,
                repeatPer : 1,
                numRemaining : Number(daysToAmortize) - 1,
                numAmor : daysToAmortize,
                nexDate : nextDateString,
                linkTrx : jeId,
                item : item,
                line : lineNum,
                sourceTrx : trxId,
                startDate : startDate,
                endDate : endDate,
                timePeriod : 1 //Daily
            });
            log.debug('Memorized Transaction Created', `Memorized Transaction ID: ${memTrxId} for SO Line: ${lineNum}`);
            log.debug('memTrxId',memTrxId);
            
            record.submitFields({
                type : 'journalentry',
                id : jeId,
                values : {
                    custbody_abj_privy_amor_rev_def_journa : memTrxId
                },
                options: {
                    enablesourcing: false,
                    ignoreMandatoryFields: true
                }
            });
            
            

            // Pass the created IDs to the reduce stage to update the Sales Order safely
            context.write({
                key: trxId,
                value: {
                    recordType : recordType,
                    line: lineNum,
                    jeId: jeId,
                    memTrxId: memTrxId
                }
            });

        } catch (e) {
            log.error('Error in Map Stage', e.message);
        }
    };

    const reduce = (context) => {
        const trxId = context.key;
        const lineUpdates = context.values.map(JSON.parse);
        let recordType = lineUpdates[0].recordType;

        try {
            // 5. Update the original Sales Order lines
            // We do this in reduce so we only load and save the SO once, avoiding collision errors.
            const soRec = record.load({
                type: recordType,
                id: trxId,
                isDynamic: false // Standard mode is usually faster for line updates
            });

            lineUpdates.forEach(update => {
                const lineIndex = soRec.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'line',
                    value: update.line
                });

                if (lineIndex !== -1) {
                    soRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_abj_link_transaction',
                        line: lineIndex,
                        value: update.jeId
                    });
                    
                    if (update.memTrxId) {
                        soRec.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_abj_link_memorized_trx',
                            line: lineIndex,
                            value: update.memTrxId
                        });
                    }
                }
            });

            const updatedSoId = soRec.save();
            log.debug('Sales Order Updated', `SO ID: ${updatedSoId} successfully updated with JE links.`);

        } catch (e) {
            log.error(`Error Updating SO ${trxId} in Reduce`, e.message);
        }
    };

    const summarize = (summary) => {
        log.audit('Map/Reduce Complete', `Processed ${summary.mapSummary.keys.length} keys.`);
        
        summary.mapSummary.errors.iterator().each((key, error) => {
            log.error(`Map Error for key: ${key}`, error);
            return true;
        });
        
        summary.reduceSummary.errors.iterator().each((key, error) => {
            log.error(`Reduce Error for key: ${key}`, error);
            return true;
        });
    };

    return { getInputData, map, reduce, summarize };
});