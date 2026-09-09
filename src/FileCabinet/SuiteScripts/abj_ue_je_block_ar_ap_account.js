/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record','N/search','N/error'], (record, search, error) => {

    const beforeLoad = (context) => {
        log.debug('Before Load', context.type);
    };

    const beforeSubmit = (context) => {
        log.debug('Before Submit', context.type);
        const newRec = context.newRecord;
        let lineCount = newRec.getLineCount({ sublistId : 'line'});
        let accounts = []
        for (let index = 0; index < lineCount; index++) {
            const account = newRec.getSublistValue({ sublistId : 'line', fieldId : 'account', line : index});
            log.debug('account', account);
            if (account && !accounts.includes(account)) {
                accounts.push(account);
            }
        }
        if(accounts && accounts.length > 0){
            let accountSearch = search.create({
                type: search.Type.ACCOUNT,
                filters: [
                    ['internalid', 'anyof', accounts],
                    'AND',
                    ['type', 'anyof', ['AcctRec', 'AcctPay']]
                ]
            });
    
            if (accountSearch.runPaged().count > 0) {
                throw  'AR or AP account is not allowed.';
            }
        }

    };

    const afterSubmit = (context) => {
        log.debug('After Submit', context.type);
    };

    return { beforeLoad, beforeSubmit, afterSubmit };
});
