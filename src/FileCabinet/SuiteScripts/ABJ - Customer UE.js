/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/search'], (record, log, search) => {

    /**
     * Triggered after the Customer record is saved
     * @param {Object} scriptContext
     */
    const afterSubmit = (scriptContext) => {
        try {
            if (scriptContext.type !== scriptContext.UserEventType.CREATE &&
                scriptContext.type !== scriptContext.UserEventType.EDIT) {
                return;
            }

            const customerRecord = scriptContext.newRecord;
            const customerId = customerRecord.id;

            log.debug('customerId', customerId);

            


        } catch (e) {
            log.error({
                title: 'Error in Customer UE afterSubmit',
                details: e.message || e.toString()
            });
        }
    };

    return {
        afterSubmit
    };
});