/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/query', 'N/runtime', 'N/log', 'N/search', 'N/task'], (record, query, runtime, log, search, task) => {

    const PARENT_FIELD_ID = 'custrecord_abj_parent_pricelist'; // Ganti sesuai ID field parent Anda

    const getInputData = (context) => {
        try {
            
            let searchData = search.load({
                id: 'customsearch532'
            });

            const count = searchData.runPaged().count;

            if (count === 0) {
                log.audit('Status Execution', 'Nothing to execute');
                return []; // Mengembalikan array kosong untuk menghentikan Map/Reduce dengan aman
            }

            log.audit('Status Execution', `Found ${count} record(s) to process.`);

            return searchData;
        } catch (e) {
            log.error('Error in getInputData', e);
            return {};
        }
    };

    const map = (context) => {
        try {
            const searchResult = JSON.parse(context.value);
            const values = searchResult.values;
            // log.debug('MAP : values', values);

            const parentId = values.formulatext;
            // const item = values.item[0].value; // Alternatif jika ingin grouping berdasarkan Item

            // Kelompokkan data ke Reduce berdasarkan PARENTId
            context.write({
                key: parentId, 
                value: {
                    internalId: searchResult.id,
                    lineId: values.line,
                    tranDate: values.trandate,
                    idPriceListLine: values.custcol_abj_id_price_list_line?.value || '',
                    recordType: searchResult.recordType
                }
            });
        } catch (e) {
            log.error('Error in map', e);
        }
    };

    const reduce = (context) => {
        

        try {
            const parentId = context.key;
            const transactions = context.values.map(v => JSON.parse(v));
            const scriptObj = runtime.getCurrentScript();

            log.debug('transactions', transactions);

            if (transactions.length <= 1) {
                log.audit('Skip', `Hanya ada 1 atau 0 transaksi untuk Parent ID: ${parentId}. Tidak perlu disinkronkan.`);
                return;
            }

            

            const latestTransaction = transactions[transactions.length - 1]; // Ambil transaksi terakhir (terbaru) berdasarkan urutan Map/Reduce
            const targetPriceListLine = latestTransaction.idPriceListLine;

            log.audit('Latest Transaction Found', `Parent: ${parentId} | Latest TranId: ${latestTransaction.internalId} | Target PriceList: ${targetPriceListLine}`);

            if (!targetPriceListLine) {
                log.error('Missing Data', `Transaksi terbaru tidak memiliki Price List Line. Skip update.`);
                return;
            }

            // 2. Loop dan update transaksi lain yang price list-nya berbeda
            let updateCount = 0;
            for (let i = 0; i < transactions.length; i++) {
                let remainingUsage = scriptObj.getRemainingUsage();
                log.debug('Remaining Usage', remainingUsage);
                // if (remainingUsage < 4971) {
                if (remainingUsage < 100) {
                    log.audit('Governance Limit Warning', `Usage hampir habis (${remainingUsage}) untuk Parent ID: ${parentId}. Berhenti di transaksi index ${i} dari total ${transactions.length}. jadwalkan/submit ulang script untuk memproses sisanya.`);
                    context.write({
                        key: 'RESCHEDULE_NEEDED',
                        value: 'true'
                    });
                    break;
                }

                const currentTx = transactions[i];
                log.debug('currentTx', currentTx);

                if (currentTx.idPriceListLine !== targetPriceListLine) {
                    try {
                        // Load transaksi
                        const rec = record.load({
                            type: currentTx.recordType,
                            id: currentTx.internalId
                        });

                        // Cari baris yang sesuai dan gunakan API Standard Mode (getSublistValue / setSublistValue)
                        const lineCount = rec.getLineCount({ sublistId: 'item' });
                        for (let j = 0; j < lineCount; j++) {
                            const currentLineId = rec.getSublistValue({ 
                                sublistId: 'item', 
                                fieldId: 'line', 
                                line: j 
                            });
                            
                            if (String(currentLineId) === String(currentTx.lineId)) {
                                // Set value langsung ke index baris tersebut tanpa selectLine
                                rec.setSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'custcol_abj_id_price_list_line',
                                    line: j,
                                    value: targetPriceListLine
                                });
                                break; // Hentikan pencarian baris jika sudah ketemu
                            }
                        }

                        rec.save({
                            disableTriggers: true
                        });
                        updateCount++;
                        log.debug('Update Success', `Updated Tx InternalID: ${currentTx.internalId}, Line: ${currentTx.lineId}`);

                    } catch (e) {
                        log.error(`Failed to update Tx: ${currentTx.internalId}`, e.message);
                    }
                }
            }

            log.audit('Reduce Summary', `Parent: ${parentId} | Diperbarui: ${updateCount} baris`);

        } catch (e) {
            log.error(`Failed to update Usage ID ${trxId}`, e);
        }
    };

    const summarize = (summary) => {
        // log.audit('Map/Reduce Selesai', `Total Error: ${summary.mapSummary.errors.iterator().hasNext() ? 'Ada' : '0'}`);
        let needsReschedule = false;

        // Cek apakah ada pesan RESCHEDULE_NEEDED dari fase reduce
        summary.output.iterator().each((key, value) => {
            if (key === 'RESCHEDULE_NEEDED' && value === 'true') {
                needsReschedule = true;
            }
            return true;
        });


        // Jika ada yang belum selesai karena limit per parent, panggil ulang scriptnya
        if (needsReschedule) {
            log.audit('Rescheduling', 'Terdapat Parent ID dengan transaksi melebihi limit. Menjadwalkan ulang script...');
            try {
                const scriptObj = runtime.getCurrentScript();
                const mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: scriptObj.id,
                    deploymentId: scriptObj.deploymentId
                });
                mrTask.submit(); // Masuk antrean ulang secara otomatis
                log.audit('Rescheduling Success', 'Script berhasil dimasukkan ke antrean.');
            } catch (e) {
                log.error('Rescheduling Failed', e.message);
            }
        }
    };

    return {
        getInputData,
        map,
        reduce,
        summarize
    };
});