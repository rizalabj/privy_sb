/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/task', 'N/log', 'N/search'], (task, log, search) => {
    
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

    const afterSubmit = (context) => {
        log.debug('After Submit Type', context.type);
        if (context.type === context.UserEventType.DELETE) return;

        const rec = context.newRecord;
        const oldRec = context.oldRecord;
        const recType = rec.type;
        const recId = rec.id;

       

        if (!APPROVAL_CONFIG[recType]) return;
        
        const config = APPROVAL_CONFIG[recType];
        log.debug('Approval Config', `Record Type: ${recType}, Status Field: ${config.statusField}, Approved Value: ${config.approvedValue}`);

        let oldStatus = null;
        if (oldRec) {
            oldStatus = oldRec.getValue({ fieldId: config.statusField }).toLowerCase().replaceAll(" ", "");
        }

        let classId = rec.getValue({ fieldId : 'class'});
        let customForm = rec.getValue({ fieldId : 'customform'});
        if(!classId) return;
        let allowedClass = [];
        let allowedCustomForm = [
            "132", // Privy - Sales Order Prepaid
            "161", // Privy - Sales Order Postpaid Top Up
            "187" // Privy - Invoice (Payment Gateway)
        ];
        const loadSearchClass = search.load({ id : 'customsearch_abj_billing_type_class'});
        loadSearchClass.run().each(function(result) {
            
            allowedClass.push(result.id);
            
            // Option B: If you need a specific column value instead, use getValue:
            // allowedClass.push(result.getValue({ name: 'column_name' }));
            
            return true; // Return true to continue iterating through all results
        });
        log.debug('allowedClass', allowedClass); 
        if(!allowedClass.includes(classId)){
            log.audit('ignored auto amort class', classId);
            return;
        }
        log.debug('allowedCustomForm', allowedCustomForm); 
        if(!allowedCustomForm.includes(customForm)){
            log.audit('ignored auto amort customform', customForm);
            return;
        }
        
        log.audit('allowed auto amort class', classId);
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