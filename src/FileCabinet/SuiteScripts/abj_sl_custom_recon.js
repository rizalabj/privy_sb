/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/task', 'N/runtime', 'N/record', 'N/file', 'N/redirect', 'N/format'], 
(serverWidget, search, task, runtime, record, file, redirect, format) => {

    var PAGE_SIZE = 20;

    // ========================================================================
    // HELPER FUNCTIONS
    // ========================================================================

    const createCustomCBRHistory = (userId, fileId, bankAccount, paymentMethod) => {
        try {
            const cbrRec = record.create({
                type: 'customtransaction_sos_cbr_history',
                isDynamic: true
            });
            cbrRec.setValue({ fieldId: 'custbody_sos_cbr_status_import', value: 'START' });
            cbrRec.setValue({ fieldId: 'subsidiary', value: 1 });
            cbrRec.setValue({ fieldId: 'custbody_sos_cbr_message', value: 'Processing...' });
            cbrRec.setValue({ fieldId: 'custbody_sos_cbr_user', value: userId });
            cbrRec.setValue({ fieldId: 'custbody_sos_recon_pay_method', value: paymentMethod });
            cbrRec.setValue({ fieldId: 'custbody_sos_recon_bank_account', value: bankAccount });
            cbrRec.setValue({ fieldId: 'custbody_sos_cbr_file', value: fileId });

            const id = cbrRec.save();
            log.debug('Custom CBR Created', `Internal ID: ${id}`);
            return id;
        } catch (e) {
            log.error('Error creating CBR record', e);
            throw e;
        }
    };

    const parseCSV = (csvContent) => {
        let lines = csvContent.split(/\r?\n/);
        let result = [];
        
        for (let i = 1; i < lines.length; i++) {
            let line = lines[i];
            if (!line) continue;

            // Regex untuk split koma, mengabaikan koma di dalam tanda kutip ("")
            let columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            const cleanText = (val) => val ? val.replace(/(^"|"$)/g, '').trim() : '';
            const parseNum = (val) => parseFloat(cleanText(val).replace(/,/g, '')) || 0;

            result.push({
                index: i,
                merchant_name: cleanText(columns[1]),
                transaction_date: cleanText(columns[3]),
                doku_invoice: cleanText(columns[4]),
                amount: parseNum(columns[6]),
                fee: parseNum(columns[8]),
                payout_date: cleanText(columns[10]),
                qris_transaction_id: cleanText(columns[14])
            });
        }
        return result;
    };

    const getNetSuiteData = (orderIds) => {
        log.debug('orderIds', orderIds)
        if (!orderIds || orderIds.length === 0) return [];
        const searchObject = search.load({
            id : 'customsearch_abj_pg_settlement'
        });
        let dynamicFilters = [];
        orderIds.forEach((id, index) => {
            dynamicFilters.push(['custbody_abj_pg_order_id', 'is', id]);
            if (index < orderIds.length - 1) dynamicFilters.push('OR');
        });
        log.debug('dynamicFilters', dynamicFilters)

        // 2. Timpa atau gabungkan dengan filter bawaan Saved Search
        let existingFilters = searchObject.filterExpression;
        
        if (existingFilters && existingFilters.length > 0) {
            searchObject.filterExpression = [existingFilters, 'AND', dynamicFilters];
        } else {
            searchObject.filterExpression = dynamicFilters;
        }

        log.debug('searchObject.filterExpression',searchObject.filterExpression);
        

        let resultsData = [];
        
        // Eksekusi pencarian
        searchObject.run().each(result => {
            log.debug('result', result)
            let orderId = result.getValue({ name: 'custbody_abj_pg_order_id', summary: search.Summary.GROUP }) || '';
            let grandTotal = result.getValue({ name: 'amountremaining', summary: search.Summary.SUM }) || '';
            if(!orderId){
                return true;
            }
            const findExisting = resultsData.find(res => res.order_id == orderId);
            if(findExisting){
                findExisting.grand_total = Number(findExisting.grand_total) + grandTotal;
            }
            resultsData.push({
                order_id: orderId,
                invoice_no: result.getValue({ name: 'tranid', summary: search.Summary.GROUP }) || '',
                customer: result.getText({ name: 'entity', summary: search.Summary.GROUP }) || result.getValue({ name: 'entity', summary: search.Summary.GROUP }) || '',
                date: result.getValue({ name: 'trandate', summary: search.Summary.GROUP }) || '',
                payout_date: result.getValue({ name: 'trandate', join: 'payingtransaction', summary: search.Summary.GROUP }) || '',
                grand_total: grandTotal,
                fee: parseFloat(result.getValue('custbody_fee_amount')) || 0
            });
            return true; 
        });

        log.debug('resultsData', resultsData);

        return resultsData; 
    };

    const matchData = (csvData, netsuiteData) => {
        let finalData = [];
        
        csvData.forEach(row => {
            // Cari data di NetSuite berdasarkan Order ID (QRIS Transaction ID)
            let findNsData = netsuiteData.find(ns => ns.order_id === row.qris_transaction_id);
            
            let matchedNsData = false;
            
            if (findNsData) {
                
                let isCustomerMatch   = (findNsData.customer === row.merchant_name);
                let isDateMatch       = (findNsData.date === row.transaction_date);
                let isPayoutDateMatch = (findNsData.payout_date === row.payout_date);
                let isGrandTotalMatch = (parseFloat(findNsData.grand_total) === parseFloat(row.amount));

                // Status match = true KECUALI untuk Invoice No dan Fee
                if (isDateMatch && isGrandTotalMatch) {
                    matchedNsData = true;
                }
            }
            
            finalData.push({
                // --- SISI KIRI (INVOICE - DARI NETSUITE / SAVED SEARCH) ---
                index: row.index,
                inv_order_id: findNsData ? findNsData.order_id : '',
                inv_invoice_no: findNsData ? findNsData.invoice_no : '',
                inv_customer: findNsData ? findNsData.customer : '',
                inv_date: findNsData ? findNsData.date : '',
                inv_payout_date: findNsData ? findNsData.payout_date : '',
                inv_grand_total: findNsData ? findNsData.grand_total : 0,

                // --- SISI KANAN (SETTLEMENT - DARI CSV UPLOAD) ---
                set_order_id: row.qris_transaction_id,
                set_customer: row.merchant_name,
                set_date: row.transaction_date,
                set_payout_date: row.payout_date,
                set_grand_total: row.amount,
                set_fee: row.fee,
                
                // --- MATCH STATUS ---
                is_match: matchedNsData ? 'Yes' : 'No'
            });
        });
        
        return finalData;
    };

    // ========================================================================
    // PAGE RENDERERS & HANDLERS
    // ========================================================================

    // 1. Render Form Upload Awal
    const renderUploadForm = (context) => {
        let form = serverWidget.createForm({ title: 'Custom Reconciliation' });

        let bankAccountField = form.addField({ id: 'custpage_bank_account', type: serverWidget.FieldType.SELECT, label: 'Bank Account' });
        bankAccountField.addSelectOption({ value: '', text: '--Select Bank Account--' });
        search.create({ type: search.Type.ACCOUNT, filters: [['type', 'anyof', 'Bank']], columns: ['internalid', 'name'] }).run().each(result => {
            bankAccountField.addSelectOption({ value: result.getValue('internalid'), text: result.getValue('name') });
            return true;
        });

        let paymentMethodField = form.addField({ id: 'custpage_payment_method', type: serverWidget.FieldType.SELECT, label: 'Payment Method' });
        paymentMethodField.addSelectOption({ value: '', text: '--Select Payment Method--' });
        search.create({ type: "paymentmethod", filters: [['isinactive', 'anyof', 'F']], columns: ['internalid', 'name'] }).run().each(result => {
            paymentMethodField.addSelectOption({ value: result.getValue('internalid'), text: result.getValue('name') });
            return true;
        });

        form.addField({ id: 'custpage_upload_file', type: serverWidget.FieldType.FILE, label: 'Upload File' });
        form.addField({ id: 'custpage_step', type: serverWidget.FieldType.TEXT, label: 'Step' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = 'upload';
        
        form.addSubmitButton({ label: 'Next: Preview Data' });
        context.response.writePage(form);
    };

    // 2. Handle Submit dari Form Upload
    const handleUploadForm = (context) => {
        const { request, response } = context;
        const fileObj = request.files.custpage_upload_file;
        const bankAccount = request.parameters.custpage_bank_account;
        const paymentMethod = request.parameters.custpage_payment_method;
        const userId = runtime.getCurrentUser().id;

        if (!fileObj) {
            response.write('Error: Tidak ada file yang diupload.');
            return;
        }

        fileObj.folder = 664110; // Folder Temp
        let newName = `CBR__${userId}_${Date.now()}_${fileObj.name}`;
        fileObj.name = newName;
        const fileId = fileObj.save();

        // Redirect ke halaman Preview
        redirect.toSuitelet({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
            parameters: {
                'step': 'preview',
                'fileId': fileId,
                'page': '1',
                'bank': bankAccount,
                'method': paymentMethod
            }
        });
    };

    const renderPreviewPage = (context) => {
        const { request, response } = context;
        let fileId = request.parameters.fileId || request.parameters.custpage_file_id;
        let pageId = parseInt(request.parameters.page) || 1;
        let bankAccount = request.parameters.bank;
        let paymentMethod = request.parameters.method;
        let pageSize = parseInt(request.parameters.pagesize) || PAGE_SIZE;
        
        // 1. Ambil Parameter Tanggal dari URL
        let startDateParam = request.parameters.startdate || '';
        let endDateParam = request.parameters.enddate || '';

        let form = serverWidget.createForm({ title: `Preview Reconciliation (Page ${pageId})` });

        let selectedIdsParam = request.parameters.custpage_selected_ids || request.parameters.selectedids || '[]';

        // Buat hidden field
        let hiddenSelected = form.addField({ 
            id: 'custpage_selected_ids', 
            type: serverWidget.FieldType.LONGTEXT, 
            label: 'Selected IDs' 
        });
        hiddenSelected.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        hiddenSelected.defaultValue = selectedIdsParam;

        // 2. Tambahkan Field Filter Tanggal
        form.addField({ id: 'custpage_start_date', type: serverWidget.FieldType.DATE, label: 'Start Date (Settlement)' })
            .defaultValue = startDateParam;
        form.addField({ id: 'custpage_end_date', type: serverWidget.FieldType.DATE, label: 'End Date (Settlement)' })
            .defaultValue = endDateParam;

        // Load & Parse CSV
        let fileObj = file.load({ id: fileId });
        let csvData = parseCSV(fileObj.getContents()); //
        log.debug('csvData', csvData);
        // 3. HITUNG TOTAL AWAL BERDASARKAN MEMORI
        let initialTotalAmount = 0;
        csvData.forEach(row => {
            // Jika csv_line_index baris ini ada di dalam array yang dicentang
            if (selectedIdsParam.includes(row.index)) {
                initialTotalAmount += parseFloat(row.amount) || 0; // Sesuaikan dengan nama properti amount di parseCSV Anda
            }
        });
        // 3. Logika Filter Tanggal
        if (startDateParam || endDateParam) {
            
            // Parsing tanggal dari filter UI NetSuite menggunakan N/format (format sesuai preferensi User)
            let start = startDateParam ? format.parse({ value: startDateParam, type: format.Type.DATE }) : null;
            let end = endDateParam ? format.parse({ value: endDateParam, type: format.Type.DATE }) : null;
            log.debug('start', start);
            log.debug('end', end);
            
            // Normalkan jamnya untuk perbandingan
            if (start) start.setHours(0, 0, 0, 0); // Awal hari
            if (end) end.setHours(23, 59, 59, 999); // Akhir hari
            
            csvData = csvData.filter(row => {
                if (!row.transaction_date) return true; // Lewati jika kosong
                
                let dateOnly = row.transaction_date.split('T')[0]; 
                log.debug('dateOnly', dateOnly);
                
                
                let dateParts = dateOnly.split('/'); // Format CSV: DD/MM/YYYY
                log.debug('dateParts', dateParts);
                
                if (dateParts.length !== 3) return true; // Cek pengaman jika format tidak sesuai
                
                let year = parseInt(dateParts[2], 10);
                let month = parseInt(dateParts[1], 10) - 1; // JS Month dimulai dari 0 (0 = Jan, 8 = Sept)
                let day = parseInt(dateParts[0], 10); 

                // Jika ternyata format CSV-nya YYYY-MM-DD (9 Oktober), maka tukar kodenya menjadi:
                // let month = parseInt(dateParts[1], 10) - 1;
                // let day = parseInt(dateParts[2], 10);
                
                // 4. Buat objek tanggal dengan jam netral (00:00:00)
                let rowDate = new Date(year, month, day);
                rowDate.setHours(0, 0, 0, 0);
                log.debug('rowDate', rowDate);
                log.debug('start', start);
                log.debug('end', end);
                
                // Cek Validitas
                if (isNaN(rowDate.getTime())) return true;
                
                // Bandingkan secara absolut
                if (start && rowDate < start) return false;
                if (end && rowDate > end) return false;
                
                return true;
            });
            
            // Reset ke halaman 1 setelah filter
            if (!request.parameters.page) pageId = 1; 
        }

        // Pagination Logic
        let totalRecords = csvData.length;
        let totalPages = Math.ceil(totalRecords / pageSize) || 1;
        if (pageId > totalPages) pageId = totalPages; // Pengaman
        
        let startIndex = (pageId - 1) * pageSize;
        let endIndex = startIndex + pageSize;
        let paginatedCsv = csvData.slice(startIndex, endIndex);

        let pageOrderIds = paginatedCsv.map(row => row.qris_transaction_id).filter(id => id !== ''); //[cite: 2]
        
        let netsuiteData = getNetSuiteData(pageOrderIds);
        let paginatedData = matchData(paginatedCsv, netsuiteData);
        let countMatchedOnThisPage = paginatedData.filter(row => row.is_match === 'Yes').length;
        let sublist = form.addSublist({
            id: 'custpage_recon_list',
            type: serverWidget.SublistType.LIST,
            label: `Data Preview (${totalRecords > 0 ? startIndex + 1 : 0} - ${Math.min(endIndex, totalRecords)} dari ${totalRecords})`
        });

        sublist.addMarkAllButtons(); // Otomatis tambah Check All / Uncheck All

        // Kolom Kiri (Invoice)
        sublist.addField({ id: 'custpage_inv_order_id', type: serverWidget.FieldType.TEXT, label: 'Order ID' });
        sublist.addField({ id: 'custpage_inv_invoice_no', type: serverWidget.FieldType.TEXT, label: 'Invoice#' });
        sublist.addField({ id: 'custpage_inv_customer', type: serverWidget.FieldType.TEXT, label: 'Customer' });
        sublist.addField({ id: 'custpage_inv_date', type: serverWidget.FieldType.TEXT, label: 'Date' });
        sublist.addField({ id: 'custpage_inv_grand_total', type: serverWidget.FieldType.CURRENCY, label: 'Grand Total' });
        
        // Kolom Kanan (Settlement)
        sublist.addField({ id: 'custpage_set_order_id', type: serverWidget.FieldType.TEXT, label: 'Order ID' });
        sublist.addField({ id: 'custpage_set_customer', type: serverWidget.FieldType.TEXT, label: 'Customer' });
        sublist.addField({ id: 'custpage_set_date', type: serverWidget.FieldType.TEXT, label: 'Date' });
        sublist.addField({ id: 'custpage_set_payout_date', type: serverWidget.FieldType.TEXT, label: 'Payout Date' });
        sublist.addField({ id: 'custpage_set_grand_total', type: serverWidget.FieldType.CURRENCY, label: 'Grand Total' });
        sublist.addField({ id: 'custpage_set_fee', type: serverWidget.FieldType.CURRENCY, label: 'Fee' });
        sublist.addField({ id: 'custpage_is_match', type: serverWidget.FieldType.TEXT, label: 'Match' });

        // Kolom Checkbox
        sublist.addField({ id: 'custpage_checkbox_select', type: serverWidget.FieldType.CHECKBOX, label: 'Select' });
        sublist.addField({ id: 'custpage_csv_index', type: serverWidget.FieldType.INTEGER, label: 'CSV Index' })
           .updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        // Set Data ke Sublist
        paginatedData.forEach((row, index) => {
            sublist.setSublistValue({ id: 'custpage_inv_order_id', line: index, value: row.inv_order_id || ' ' });
            sublist.setSublistValue({ id: 'custpage_inv_invoice_no', line: index, value: row.inv_invoice_no || ' ' });
            sublist.setSublistValue({ id: 'custpage_inv_customer', line: index, value: row.inv_customer || ' ' });
            sublist.setSublistValue({ id: 'custpage_inv_date', line: index, value: row.inv_date || ' ' });
            sublist.setSublistValue({ id: 'custpage_inv_grand_total', line: index, value: row.inv_grand_total || 0 });

            sublist.setSublistValue({ id: 'custpage_set_order_id', line: index, value: row.set_order_id || ' ' });
            sublist.setSublistValue({ id: 'custpage_set_customer', line: index, value: row.set_customer || ' ' });
            sublist.setSublistValue({ id: 'custpage_set_date', line: index, value: row.set_date || ' ' });
            sublist.setSublistValue({ id: 'custpage_set_payout_date', line: index, value: row.set_payout_date || ' ' });
            sublist.setSublistValue({ id: 'custpage_set_grand_total', line: index, value: row.set_grand_total || 0 });
            sublist.setSublistValue({ id: 'custpage_set_fee', line: index, value: row.set_fee || 0 });
            sublist.setSublistValue({ id: 'custpage_is_match', line: index, value: row.is_match || 'No' }); //[cite: 2]
            
            // Default check jika Match
            sublist.setSublistValue({ id: 'custpage_checkbox_select', line: index, value: 'F'});
            sublist.setSublistValue({ id: 'custpage_csv_index', line: index, value: row.index });
        });

        // Field Navigasi & Hidden
        form.addField({ id: 'custpage_page_size', type: serverWidget.FieldType.TEXT, label: 'Rows per Page' }).defaultValue = pageSize.toString();
        let pageSelect = form.addField({ id: 'custpage_page_select', type: serverWidget.FieldType.SELECT, label: 'Select Page' });
        for (let i = 1; i <= totalPages; i++) {
            pageSelect.addSelectOption({ value: i, text: `Page ${i}`, isSelected: (i === pageId) });
        }
        form.addField({ id: 'custpage_total_records', type: serverWidget.FieldType.TEXT, label: 'Total Records' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED }).updateBreakType({ breakType: serverWidget.FieldBreakType.STARTCOL }).defaultValue = totalRecords.toString();
        form.addField({ id: 'custpage_total_records_on_this_page', type: serverWidget.FieldType.TEXT, label: 'Total Matched Records on This Page' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED }).defaultValue = countMatchedOnThisPage.toString();
        let totalSelectedField = form.addField({ 
            id: 'custpage_total_selected_amount', 
            type: serverWidget.FieldType.CURRENCY, 
            label: 'Total Settlement Selected' 
        });
        log.debug('initialTotalAmount', initialTotalAmount);
        totalSelectedField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE }); // Read-only
        totalSelectedField.defaultValue = initialTotalAmount; // Set hasil hitungan dari CSV
        form.addField({ id: 'custpage_file_id', type: serverWidget.FieldType.TEXT, label: 'File ID' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = fileId;
        form.addField({ id: 'custpage_bank', type: serverWidget.FieldType.TEXT, label: 'Bank' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = bankAccount;
        form.addField({ id: 'custpage_method', type: serverWidget.FieldType.TEXT, label: 'Method' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = paymentMethod;
        form.addField({ id: 'custpage_step', type: serverWidget.FieldType.TEXT, label: 'Step' }).updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN }).defaultValue = 'process'; //[cite: 2]
        
        // 4. Tambahkan Tombol
        form.addButton({ 
            id: 'custpage_btn_apply_filter', 
            label: 'Apply Filter', 
            functionName: 'applyFilter' // Memanggil fungsi di Client Script
        });
        
        form.addButton({ 
            id: 'custpage_btn_back', 
            label: 'Back', 
            functionName: 'goBackToUpload' 
        });
        
        form.addSubmitButton({ label: 'Submit Process' });

        let cssSuntikan = form.addField({ 
            id: 'custpage_inject_css', 
            type: serverWidget.FieldType.INLINEHTML, 
            label: 'CSS' 
        });

        cssSuntikan.defaultValue = `
        <style>
            /* 1. Warna Header Kiri (Kolom 1 sampai 6) - Biru */
            #custpage_recon_listheader td:nth-child(-n+5) {
                background-color: #dbeafe !important;
                border-bottom: 2px solid #3b82f6 !important;
            }
            #custpage_recon_listheader td:nth-child(-n+6) div{
                background-color: #dbeafe !important;
            }
            
            /* 2. Warna Baris Data Kiri (Kolom 1 sampai 5) - Biru Muda */
            #custpage_recon_list_splits .uir-list-row-tr td:nth-child(-n+6) {
                background-color: #f0f8ff !important;
            }

            /* 3. Warna Header Kanan (Kolom 7 sampai 12) - Kuning */
            #custpage_recon_listheader td:nth-child(n+6):nth-child(-n+11) {
                background-color: #fef08a !important;
                border-bottom: 2px solid #eab308 !important;
            }
            #custpage_recon_listheader td:nth-child(n+6):nth-child(-n+11) div{
                background-color: #fef08a !important;
            }

            /* 4. Warna Baris Data Kanan (Kolom 7 sampai 12) - Kuning Muda */
            #custpage_recon_list_splits .uir-list-row-tr td:nth-child(n+7):nth-child(-n+12) {
                background-color: #fffaf0 !important;
            }
            
            /* 5. Opsional: Warna Kolom ke-13 (Match) agar netral */
            #custpage_recon_listheader td:nth-child(13) {
                border-bottom: 2px solid #9ca3af !important;
            }
        </style>
        <script>
            jQuery(document).ready(function() {
                let groupHeaderTR = jQuery('<tr class="uir-machine-headerrow"></tr>');
                
                groupHeaderTR.append('<td colspan="5" style="text-align: center; font-size: 14px; font-weight: bold; background-color: #dbeafe !important; border-bottom: 2px solid #3b82f6; border-right: 2px solid #ffffff; padding: 6px 0;">Invoice (NetSuite)</td>');
                groupHeaderTR.append('<td colspan="6" style="text-align: center; font-size: 14px; font-weight: bold; background-color: #fef08a !important; border-bottom: 2px solid #eab308; border-right: 2px solid #ffffff; padding: 6px 0;">Settlement (CSV Upload)</td>');
                groupHeaderTR.append('<td colspan="3" style="text-align: center; font-size: 14px; font-weight: bold; background-color: #f3f4f6 !important; border-bottom: 2px solid #9ca3af; padding: 6px 0;">Status</td>');
                
                jQuery('#custpage_recon_listheader').before(groupHeaderTR);
                jQuery('#custpage_recon_list_splits .uir-list-row-tr').each(function() {
                    // Ambil nilai text dari kolom ke-12 (Match Status)
                    let matchStatus = jQuery(this).find('td:nth-child(12)').text().trim();
                    
                    if (matchStatus !== 'Yes') {
                        // Temukan kolom ke-13 (Checkbox)
                        let checkboxCell = jQuery(this).find('td:nth-child(13)');
                        let checkboxInput = checkboxCell.find('input[type="checkbox"], input[type="hidden"]');
                        
                        // Disable elemen input HTML-nya
                        checkboxInput.prop('disabled', true);
                        
                        // Buat sel tersebut tidak merespon klik (pointer-events) dan transparan agar terlihat mati
                        checkboxCell.css({
                            'pointer-events': 'none',
                            'opacity': '0.4'
                        });
                    }
                });
            });
        </script>
        `;

        form.clientScriptModulePath = './abj_cs_custom_recon.js'; //[cite: 2]

        response.writePage(form);
    };

    // 4. Handle Submit dari Halaman Preview
    const handlePreviewSubmit = (context) => {
        const { request, response } = context;
        let fileId = request.parameters.custpage_file_id;
        let bankAccount = request.parameters.custpage_bank;
        let paymentMethod = request.parameters.custpage_method;
        let userId = runtime.getCurrentUser().id;
        let selectedIds = request.parameters.custpage_selected_ids || request.parameters.selectedids || '[]';

        // Buat History Record
        // let historyId = createCustomCBRHistory(userId, fileId, bankAccount, paymentMethod);

        try {
            // Buat Task Map/Reduce
            let mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_abj_mr_custom_recon', // Sesuaikan ID
                params: { 
                    'custscript_mr_file_id': fileId,
                    'custscript_mr_account': bankAccount,
                    'custscript_mr_payment_method': paymentMethod,
                    'custscript_selected_index' : selectedIds
                }
            });

            let taskId = mrTask.submit();
            log.debug('Map/Reduce Task Submitted', `Task ID: ${taskId}`);
            

            // Redirect ke halaman Status
            redirect.toSuitelet({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                parameters: {
                    'step': 'status',
                    'taskId': taskId
                }
            });

        } catch (e) {
            log.error('Error Submitting Map/Reduce', e.message);
            response.write(`Failed to submit Map/Reduce task: ${e.message}`);
        }
    };

    const renderStatusPage = (context) => {
        const { request, response } = context;
        let taskId = request.parameters.taskId;

        // Mengubah judul agar lebih natural
        let form = serverWidget.createForm({ title: 'Journal Reconciliation - Process Status' });

        if (!taskId) {
            form.addField({ id: 'custpage_err_msg', type: serverWidget.FieldType.INLINEHTML, label: 'Error' })
                .defaultValue = '<p>Error: Unable to find the process reference. Please try uploading your file again.</p>';
            response.writePage(form);
            return;
        }

        // Cek status Map/Reduce menggunakan N/task
        let taskStatus = task.checkStatus({ taskId: taskId });
        let rawStatus = taskStatus.status; // PENDING, PROCESSING, COMPLETE, or FAILED

        // Mapping status teknis ke bahasa yang lebih user-friendly
        let displayStatus = 'Waiting in Queue'; 
        let colorCode = '#eab308'; // Default: Kuning (Pending/Processing)

        if (rawStatus === 'PROCESSING') {
            displayStatus = 'In Progress';
        } else if (rawStatus === 'COMPLETE') {
            displayStatus = 'Completed Successfully';
            colorCode = '#22c55e'; // Hijau
        } else if (rawStatus === 'FAILED') {
            displayStatus = 'Process Failed';
            colorCode = '#ef4444'; // Merah
        }

        // HTML Content dengan bahasa Inggris yang ramah pengguna
        let htmlContent = `
            <div style="font-family: Arial, sans-serif; padding: 15px; border: 1px solid #ccc; background-color: #f9fafb; border-radius: 5px; width: 50%;">
                <p style="font-size: 14px; margin-bottom: 10px;"><b>Reference ID:</b> ${taskId}</p>
                <p style="font-size: 16px;"><b>Current Status:</b> 
                    <span style="color: ${colorCode}; font-weight: bold; background-color: white; padding: 4px 10px; border: 1px solid ${colorCode}; border-radius: 4px; margin-left: 10px;">
                        ${displayStatus}
                    </span>
                </p>
                <p style="font-size: 12px; color: #6b7280; margin-top: 15px;">
                    * Please click the <b>Refresh Status</b> button below to check for the latest updates.
                </p>
            </div>
        `;

        form.addField({ id: 'custpage_status_html', type: serverWidget.FieldType.INLINEHTML, label: 'Status View' })
            .defaultValue = htmlContent;

        // Injeksi JS untuk tombol
        form.addField({ id: 'custpage_status_js', type: serverWidget.FieldType.INLINEHTML, label: 'JS' })
            .defaultValue = `
            <script>
                function refreshPage() {
                    window.location.reload();
                }
                function backToUpload() {
                    let currentUrl = new URL(window.location.href);
                    currentUrl.searchParams.delete('step');
                    currentUrl.searchParams.delete('taskId');
                    window.location.href = currentUrl.toString();
                }
            </script>
            `;

        // Tambahkan Tombol UI
        form.addButton({ id: 'custpage_btn_refresh', label: 'Refresh Status', functionName: 'refreshPage' });
        
        // Hanya tampilkan tombol "Upload New File" jika prosesnya sudah selesai/gagal
        if (rawStatus === 'COMPLETE' || rawStatus === 'FAILED') {
            form.addButton({ id: 'custpage_btn_new', label: 'Upload New File', functionName: 'backToUpload' });
        }

        response.writePage(form);
    };

    // ========================================================================
    // MAIN ENTRY POINT
    // ========================================================================

    const onRequest = (context) => {
        const { request, response } = context;
        const step = request.parameters.step || request.parameters.custpage_step || 'upload';

        if (request.method === 'GET') {
            if (step === 'upload') {
                renderUploadForm(context);
            } else if (step === 'preview') {
                renderPreviewPage(context);
            } else if (step === 'status') {
                renderStatusPage(context); 
            }
        } else { // POST
            if (step === 'upload') {
                handleUploadForm(context);
            } else if (step === 'process') {
                handlePreviewSubmit(context);
            }
        }
    };

    return { onRequest };
});