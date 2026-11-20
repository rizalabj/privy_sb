/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/format'], (record, search, runtime, format) => {

    const createJournalEntry = ({
        templateId,
        tranDate,
        memTrxId,
        amortAmount,
        sumDiscounts
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

            const roundedCreditAmt = Math.abs(Number(amortAmount).toFixed(2));
            jeRec.setSublistValue({ sublistId: 'line', line : 2, fieldId: 'credit', value: Math.abs(roundedCreditAmt)}); 
            let roundedDiscountAmt = 0;
            if(sumDiscounts && sumDiscounts > 0){
                roundedDiscountAmt = Math.abs(Number(sumDiscounts).toFixed(2));
                jeRec.setSublistValue({ sublistId: 'line', line : 1, fieldId: 'debit', value: Math.abs(roundedDiscountAmt)});   
            }
            const roundedDebitAmt = Math.abs((roundedCreditAmt - roundedDiscountAmt).toFixed(2));
            jeRec.setSublistValue({ sublistId: 'line', line : 0, fieldId: 'debit', value: Math.abs(roundedDebitAmt)});
            

            const jeId = jeRec.save();

            return jeId;
        } catch (error) {
            log.error('error create journal entry', error)
            return null;
        }
    }

    const getDaysDifference = (dateA, dateB) => {
        // Konversi ke UTC midnight agar perbedaan jam/timezone tidak merusak hitungan hari
        const utcA = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
        const utcB = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());

        const msPerDay = 1000 * 60 * 60 * 24;
        
        // Gunakan Math.abs() jika hanya ingin tahu selisih angkanya (selalu positif)
        // Hapus Math.abs() jika ingin tahu apakah dateB lebih besar (+) atau lebih kecil (-)
        return Math.floor((utcB - utcA) / msPerDay);
    };

    function getStartDateOfMonth(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function getEndOfNextMonth(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth() + 2, 0);
    }

    
    const getInputData = () => {
        // 2. Load the saved search
        let searchData = search.load({
            id: 'customsearch557'
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
            let dayDiff = 1;
            const templateId = values.custrecord_abj_privy_amor_rev_def_link_t.value;
            
            const nextTrxDate = values.custrecord_abj_privy_amor_rev_next_date;
            const endDateRevAmort = values.custrecord_abj_privy_end_date_rev_amor;
            const numberRemaining = values.custrecord_abj_privy_amor_rev_num_remain;
            
            log.debug('nextTrxDate',nextTrxDate);
            let nextTrxDateFormated = typeof nextTrxDate === 'string' ? format.parse({ value: nextTrxDate, type: format.Type.DATE }) : new Date(nextTrxDate);
            let endDateRevAmortFormated = typeof endDateRevAmort === 'string' ? format.parse({ value: endDateRevAmort, type: format.Type.DATE }) : new Date(endDateRevAmort);
            
            log.debug('cek daydiff 1',getDaysDifference(nextTrxDateFormated, nextTrxDateFormated));
            log.debug('cek daydiff 2',getDaysDifference(nextTrxDateFormated, endDateRevAmortFormated));
            let nextDateEndDateRevDiff = getDaysDifference(nextTrxDateFormated, endDateRevAmortFormated);
            if(nextDateEndDateRevDiff <= 0){
                nextTrxDateFormated = endDateRevAmortFormated;
            }
            const startDateOfTheMonth = getStartDateOfMonth(nextTrxDateFormated);
            log.debug('startDateOfTheMonth', startDateOfTheMonth);
            dayDiff = getDaysDifference(startDateOfTheMonth, nextTrxDateFormated) + 1; // karena tanggal 1 ikut jadi ditambah 1
            log.debug('dayDiff', dayDiff);
            let nextDate = getEndOfNextMonth(nextTrxDateFormated);

            // 4. (Opsional) Format kembali ke string jika diperlukan oleh NetSuite
            let nextDateString = format.format({ value: nextDate, type: format.Type.DATE });
            if(nextDateEndDateRevDiff <= 0){
                nextDateString = '';
            }
            
            log.debug('nextDateString',nextDateString);
            let amountPerDay = Math.abs(Number(values.custrecord_abj_rev_amor_amount_b4_disc));
            let amortAmount = amountPerDay * dayDiff;
            let discountPerDay = Math.abs(Number(values.custrecord_abj_rev_amor_disc_amount));
            let sumDiscounts = discountPerDay * dayDiff;

        
            // 3. Copy the Journal Entry
            const jeId = createJournalEntry({
                memTrxId : memTrxId,
                templateId : templateId,
                tranDate : nextTrxDate,
                amortAmount : amortAmount,
                sumDiscounts : sumDiscounts
            })

            if(jeId){
                // update amortization  
                record.submitFields({
                    type : 'customrecord_abj_privy_amor_rev_def',
                    id : memTrxId,
                    values : {
                        custrecord_abj_privy_amor_rev_num_remain : Number(numberRemaining) - dayDiff,
                        custrecord_abj_privy_amor_rev_next_date : nextDateString
                    },
                    options: {
                        enablesourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            }
            
            

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