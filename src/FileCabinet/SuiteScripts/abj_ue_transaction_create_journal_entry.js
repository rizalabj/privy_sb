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