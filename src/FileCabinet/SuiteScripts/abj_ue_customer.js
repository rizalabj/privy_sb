/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log', './abj_customer_hierarchy_util', './abj_sublist_pair_validation_util'], (log, customerHierarchyUtil, sublistPairValidationUtil) => {
    const CUSTOMER_HIERARCHY_SUBLIST_ID = 'recmachcustrecord_abj_customer_link';

    const getEventRecordId = (context) => {
        if (context?.newRecord?.id) {
            return context.newRecord.id;
        }

        if (context?.oldRecord?.id) {
            return context.oldRecord.id;
        }

        return null;
    };

    const beforeSubmit = (context) => {
        if (
            context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT
        ) {
            return;
        }

        sublistPairValidationUtil.validateSublistPairs({
            record: context.newRecord,
            sublistId: CUSTOMER_HIERARCHY_SUBLIST_ID,
        });
    };

    const afterSubmit = (context) => {
        if (
            context.type !== context.UserEventType.CREATE &&
            context.type !== context.UserEventType.EDIT
        ) {
            return;
        }

        try {
            const customerId = getEventRecordId(context);

            if (!customerId) {
                log.debug('No customer id found in context, skipping execution');
                return;
            }

            const processingResult = customerHierarchyUtil.processCustomerHierarchy({
                customerId,
            });

            if (
                processingResult.hierarchyProcessed === 0 &&
                processingResult.configProcessed === 0
            ) {
                log.debug('No hierarchy/config records found for customer', {
                    customerId,
                });
                return;
            }

            log.audit('Customer hierarchy trigger completed', {
                customerId,
                hierarchyProcessed: processingResult.hierarchyProcessed,
                configProcessed: processingResult.configProcessed,
                hierarchySaved: processingResult.hierarchySaved,
                configSaved: processingResult.configSaved,
            });
        } catch (error) {
            log.error('Error executing customer hierarchy afterSubmit', error);
            throw error;
        }
    };

    return {
        beforeSubmit,
        afterSubmit,
    };
});
