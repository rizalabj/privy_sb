/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record','N/search'], (record, search) => {

    const beforeLoad = (context) => {
        log.debug('Before Load', context.type);
    };

    const beforeSubmit = (context) => {
        log.debug('Before Submit', context.type);
    };



    const WAPU_ITEM_ID = 469; 

    const saveCreditMemo = (invId, taxTotal, creditMemoId) => {
        try {
            

            if (taxTotal <= 0) {
                log.debug('Skip Credit Memo', `Tax total is 0 or invalid for Invoice #${invId}`);
                return;
            }

            // 2. Transform Invoice ke Credit Memo
            let cmRecord = null;
            if(creditMemoId){
                cmRecord = record.load({
                    type: record.Type.CREDIT_MEMO,
                    id : creditMemoId,
                    isDynamic: true
                });
            }else{
                cmRecord = record.transform({
                    fromType: record.Type.INVOICE,
                    fromId: invId,
                    toType: record.Type.CREDIT_MEMO,
                    isDynamic: true
                });

            }

            cmRecord.setValue({
                fieldId : 'customform',
                value : 180
            });

            cmRecord.setValue({
                fieldId : 'custbody_abj_ppn_report_flag',
                value : true
            });

            // 3. Hapus semua line item bawaan Invoice
            const lineCount = cmRecord.getLineCount({ sublistId: 'item' });
            for (let i = lineCount - 1; i >= 0; i--) {
                cmRecord.removeLine({
                    sublistId: 'item',
                    line: i
                });
            }

            // 4. Tambahkan 1 line item WAPU sebesar Tax Amount (1.1 Juta)
            cmRecord.selectNewLine({ sublistId: 'item' });
            cmRecord.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                value: WAPU_ITEM_ID
            });
            cmRecord.setCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                value: taxTotal
            });
            cmRecord.commitLine({ sublistId: 'item' });

            const applyLineCount = cmRecord.getLineCount({ sublistId: 'apply' });
            // for (let j = 0; j < applyLineCount; j++) {
            //     cmRecord.selectLine({
            //         sublistId: 'apply',
            //         line: j
            //     });
            //     cmRecord.setCurrentSublistValue({
            //         sublistId: 'apply',
            //         fieldId: 'apply',
            //         value: false
            //     });
            //     cmRecord.commitLine({ sublistId: 'apply' });
            // }
            for (let j = 0; j < applyLineCount; j++) {
                cmRecord.selectLine({
                    sublistId: 'apply',
                    line: j
                });
                const applyInternalId = cmRecord.getCurrentSublistValue({
                    sublistId: 'apply',
                    fieldId: 'internalid',
                    line: j
                });

                if (Number(applyInternalId) === Number(invId)) {
                    cmRecord.setCurrentSublistValue({
                        sublistId: 'apply',
                        fieldId: 'apply',
                        line: j,
                        value: true
                    });
                    cmRecord.setCurrentSublistValue({
                        sublistId: 'apply',
                        fieldId: 'amount',
                        line: j,
                        value: taxTotal   // matches the credit memo's actual total now
                    });
                } else {
                    // don't apply against anything else that might be pre-checked
                    cmRecord.setCurrentSublistValue({
                        sublistId: 'apply',
                        fieldId: 'apply',
                        line: j,
                        value: false
                    });
                }
                cmRecord.commitLine({ sublistId: 'apply' });
            }

            // 5. Set Memo Keterangan
            cmRecord.setValue({
                fieldId: 'memo',
                value: `Auto-generated WAPU Tax Credit Memo for Invoice #${invId}`
            });

            // 6. Simpan Credit Memo
            const cmId = cmRecord.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            log.audit('WAPU Credit Memo Created', `Credit Memo ID: ${cmId} (Amount: ${taxTotal}) for Invoice #${invId}`);
        } catch (error) {
            log.error(`Error Create Credit Memo | INV ID: ${invId}`, error);
            throw error;
        }
    };

    const deleteCreditMemo = (creditMemoId) =>{
        try {
            record.delete({
                type : 'creditmemo',
                id : creditMemoId
            });
        } catch (error) {
            log.error(`Error Delete Credit Memo | INV ID: ${creditMemoId}`, error);
            throw error;
        }
    }


    const searchExistingCreditMemo = (invId) =>{
        try {
            const searchRec = search.create({
                type : 'creditmemo',
                filters : [
                    ['type', 'anyof', 'CustCred'],
                    'AND',
                    ['customform', 'anyof', '180'],
                    'AND',
                    ['custbody_abj_ppn_report_flag', 'is', 'T'],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['createdfrom', 'is', invId],
                ],
                columns : ['internalid']
            });

            let searchRecResult = searchRec.run().getRange({ start : 0, end : 1});
            if(searchRecResult.length == 0){
                return null;
            }

            return searchRecResult[0].getValue('internalid');
        } catch (error) {
            log.error(`Error Search Credit Memo | INV ID: ${invId}`, error);
            throw error;
        }
    }

    const afterSubmit = (context) => {
        log.debug('After Submit', context.type);
        // if (context.type !== context.UserEventType.CREATE) return;
        const newInv = context.newRecord;
        const recId = newInv.id;
        try {
            let creditMemoId = null;

            if (context.type === context.UserEventType.DELETE) {
                creditMemoId = searchExistingCreditMemo(recId);
                if (creditMemoId) {
                    log.debug('Deleting Credit Memo due to Invoice deletion', creditMemoId);
                    deleteCreditMemo(creditMemoId);
                }
                return;
            }

            // const recordLoad = record.load({
            //     type : context.newRecord.type,
            //     id : recId
            // });
            
            // let subTotal = recordLoad.getValue({ fieldId : 'subtotal'});
            // let customerHierarchyId = recordLoad.getValue({ fieldId : 'custbody_abj_id_cust_hierarchy_con'});
            const subTotal = Number(newInv.getValue({ fieldId: 'subtotal' }) || 0);
            const customerHierarchyId = newInv.getValue({ fieldId: 'custbody_abj_id_cust_hierarchy_con' });
            const taxAmount = Number(newInv.getValue({ fieldId: 'taxtotal' }) || 0);
            let isWapu = false;
    
            if(Number(subTotal) > 10000000){
                isWapu = true;
            }

            if(Number(subTotal) <= 10000000 && customerHierarchyId){
                let customerHierarchyLook = search.lookupFields({
                    type : 'customrecord_abj_privy_cust_hierarchy',
                    id : customerHierarchyId,
                    columns : ['custrecord_abj_ppn_report']
                });
                log.debug('customerHierarchyLook', customerHierarchyLook);
                if(customerHierarchyLook && customerHierarchyLook?.custrecord_abj_ppn_report[0].value == 1){
                    isWapu = true;
                }
            }

            if (context.type === context.UserEventType.EDIT) {
                creditMemoId = searchExistingCreditMemo(recId);
            }
            if (!isWapu) {
                // Jika tadinya WAPU (punya Credit Memo) lalu di-edit jadi Non-WAPU -> HAPUS Credit Memo
                if (creditMemoId) {
                    log.debug('Deleting Credit Memo (Invoice changed from WAPU to Non-WAPU)', creditMemoId);
                    deleteCreditMemo(creditMemoId);
                }
                return;
            }
            
            log.debug('credit memo id', creditMemoId);
            saveCreditMemo(recId, taxAmount, creditMemoId);

        } catch (error) {
            log.error('error after submit', error);
        }
    };

    return { beforeLoad, beforeSubmit, afterSubmit };
});
