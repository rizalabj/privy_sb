/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/format'], (record, search, runtime, format) => {

    const createJournalEntry = ({
        templateId,
        tranDate,
        memTrxId
    }) =>{
        try {
            const jeRec = record.copy({
                type: record.Type.JOURNAL_ENTRY, // or custom record string ID
                id: templateId,                        // Internal ID of the record to copy
                isDynamic: false                // Optional: true for dynamic mode, false for standard mode (default)
            });

            // Set JE Header
            jeRec.setValue({ fieldId: 'customform', value: 183 }); // 2 = custom form
            jeRec.setValue({ fieldId: 'approvalstatus', value: 2 }); // 2 = Approved
            jeRec.setValue({ fieldId: 'custbody_abj_privy_amor_rev_def_journa', value: memTrxId }); 
            if (tranDate) {
                jeRec.setValue({ 
                    fieldId: 'trandate', 
                    value: format.parse({ value: tranDate, type: format.Type.DATE }) 
                });
            }

            const jeId = jeRec.save();

            return jeId;
        } catch (error) {
            log.error('error create journal entry', error)
            return null;
        }
    }

    
    const getInputData = () => {
        // 2. Load the saved search
        let searchData = search.load({
            id: 'customsearch507'
        });

        const count = searchData.runPaged().count;

        if (count === 0) {
            log.audit('Status Execution', 'Nothing to execute');
            return []; // Mengembalikan array kosong untuk menghentikan Map/Reduce dengan aman
        }

        log.audit('Status Execution', `Found ${count} record(s) to process.`);

        return searchData;
    };

    const map = (context) => {
        try {
            const searchResult = JSON.parse(context.value);
            const memTrxId = searchResult.id;
            const values = searchResult.values;
            log.debug('values', values);
            const templateId = values.custrecord_abj_privy_amor_rev_def_link_t.value;
            const nextTrxDate = values.custrecord_abj_privy_amor_rev_next_date;
            const numberRemaining = values.custrecord_abj_privy_amor_rev_num_remain;
            
            let nextTrxDateFormated = typeof nextTrxDate === 'string' ? format.parse({ value: nextTrxDate, type: format.Type.DATE }) : new Date(nextTrxDate);
            let nextDate = new Date(nextTrxDateFormated);
            nextDate.setDate(nextDate.getDate() + 1);

            // 4. (Opsional) Format kembali ke string jika diperlukan oleh NetSuite
            let nextDateString = format.format({ value: nextDate, type: format.Type.DATE });
            log.debug('nextTrxDate',nextTrxDate);
            log.debug('nextDateString',nextDateString);
        
            // 3. Copy the Journal Entry
            const jeId = createJournalEntry({
                memTrxId : memTrxId,
                templateId : templateId,
                tranDate : nextTrxDate
            })

            // update amortization  
            record.submitFields({
                type : 'customrecord_abj_privy_amor_rev_def',
                id : memTrxId,
                values : {
                    custrecord_abj_privy_amor_rev_num_remain : Number(numberRemaining) - 1,
                    custrecord_abj_privy_amor_rev_next_date : nextDateString
                },
                options: {
                    enablesourcing: false,
                    ignoreMandatoryFields: true
                }
            });
            
            

            // Pass the created IDs to the reduce stage to update the Sales Order safely
            context.write({
                key: memTrxId,
                value: {
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
        // const lineUpdates = context.values.map(JSON.parse);
        try {
            

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
        
        // summary.reduceSummary.errors.iterator().each((key, error) => {
        //     log.error(`Reduce Error for key: ${key}`, error);
        //     return true;
        // });
    };

    return { getInputData, map, reduce, summarize };
});