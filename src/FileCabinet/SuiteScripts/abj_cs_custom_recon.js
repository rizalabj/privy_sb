/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/url', 'N/currentRecord'], (url, currentRecord) => {

    // Helper: Mengambil array dari hidden field
    function getSelectedIds(rec) {
        let val = rec.getValue({ fieldId: 'custpage_selected_ids' });
        try { return val ? JSON.parse(val) : []; } catch (e) { return []; }
    }

    // FUNGSI INTI: Menyapu bersih seluruh tabel di layar dan menyimpannya ke memori.
    // Ini adalah kunci agar "Mark All" / "Unmark All" terbaca!
    function syncCurrentPageToMemory(rec) {
        let selectedArray = getSelectedIds(rec);
        let lineCount = rec.getLineCount({ sublistId: 'custpage_recon_list' });
        
        // Ambil total saat ini yang ada di layar
        let currentTotal = parseFloat(rec.getValue({ fieldId: 'custpage_total_selected_amount' })) || 0;
        console.log('Current Total Before Sync:', currentTotal);
        
        for (let i = 0; i < lineCount; i++) {
            let isMatch = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_is_match', line: i });
            let isChecked = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_checkbox_select', line: i });
            let csvIdxStr = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_csv_index', line: i });
            let amountStr = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_set_grand_total', line: i }); // Ambil nilai uang baris ini
            console.log('csvIdxStr', { csvIdxStr, isMatch});

            if (csvIdxStr) {
                let csvIndex = parseInt(csvIdxStr, 10);
                let rowAmount = parseFloat(amountStr) || 0;

                if ((isChecked === true || isChecked === 'T') && isMatch != 'No') {
                    // Jika dicentang tapi belum ada di memori, tambahkan ke array dan tambahkan uangnya ke total
                    if (!selectedArray.includes(csvIndex)) {
                        selectedArray.push(csvIndex);
                        currentTotal += rowAmount;
                    }
                } else {
                    // Jika tidak dicentang tapi sebelumnya ada di memori, hapus dari array dan kurangi uangnya dari total
                    if (selectedArray.includes(csvIndex)) {
                        selectedArray = selectedArray.filter(id => id !== csvIndex);
                        currentTotal -= rowAmount;
                    }
                }
            }
        }
        
        // Simpan array terbaru ke hidden field
        rec.setValue({ fieldId: 'custpage_selected_ids', value: JSON.stringify(selectedArray), ignoreFieldChange: true });
        
        // Update field Total Amount di layar secara real-time
        rec.setValue({ fieldId: 'custpage_total_selected_amount', value: currentTotal, ignoreFieldChange: true });
    }

    // 1. Inisialisasi Halaman
    const pageInit = (context) => {
        let rec = context.currentRecord;
        let selectedArray = getSelectedIds(rec);
        let lineCount = rec.getLineCount({ sublistId: 'custpage_recon_list' });
        
        for (let i = 0; i < lineCount; i++) {
            let csvIdxStr = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_csv_index', line: i });
            let isMatch = rec.getSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_is_match', line: i });
            console.log('csvIdxStr', { csvIdxStr, isMatch});
            
            if (csvIdxStr && isMatch != 'No') {
                let csvIndex = parseInt(csvIdxStr, 10);
                if (selectedArray.includes(csvIndex)) {
                    // PENGGUNAAN AMAN DI PAGE INIT (Tidak memicu infinite loop)
                    rec.selectLine({ sublistId: 'custpage_recon_list', line: i });
                    rec.setCurrentSublistValue({ sublistId: 'custpage_recon_list', fieldId: 'custpage_checkbox_select', value: true, ignoreFieldChange: true });
                    rec.commitLine({ sublistId: 'custpage_recon_list' });
                }
            }
        }

        if (typeof window !== 'undefined' && window.document) {
            let markAllBtn = document.getElementById('custpage_recon_listmarkall');
            let unmarkAllBtn = document.getElementById('custpage_recon_listunmarkall');
            if (markAllBtn) markAllBtn.addEventListener('click', () => setTimeout(() => syncCurrentPageToMemory(context.currentRecord), 300));
            if (unmarkAllBtn) unmarkAllBtn.addEventListener('click', () => setTimeout(() => syncCurrentPageToMemory(context.currentRecord), 300));
        }
        syncCurrentPageToMemory(rec);
    };

    // 2. Tombol Apply Filter
    function applyFilter() {
        var rec = currentRecord.get();
        
        // PENTING: Sapu bersih checkbox di layar ke memori SEBELUM me-refresh halaman
        syncCurrentPageToMemory(rec);
        
        var startDate = rec.getText({ fieldId: 'custpage_start_date' });
        var endDate = rec.getText({ fieldId: 'custpage_end_date' });
        var fileId = rec.getValue({ fieldId: 'custpage_file_id' });
        var bankAccount = rec.getValue({ fieldId: 'custpage_bank' });
        var paymentMethod = rec.getValue({ fieldId: 'custpage_method' });
        var selectedIds = rec.getValue({ fieldId: 'custpage_selected_ids' }); // Memori terbaru
        
        var suiteletUrl = url.resolveScript({
            scriptId: 'customscript_abj_sl_custom_recon', 
            deploymentId: 'customdeploy_abj_sl_custom_recon', 
            params: {
                'step': 'preview',
                'fileId': fileId,
                'bank': bankAccount,
                'method': paymentMethod,
                'page': '1', 
                'startdate': startDate,
                'enddate': endDate,
                'selectedids': selectedIds 
            }
        });
        
        window.onbeforeunload = null; 
        window.location.href = suiteletUrl;
    }

    // 3. Menangani perubahan Field & Dropdown
    const fieldChanged = (context) => {
        const { fieldId } = context;
        var rec = currentRecord.get();
        
        // Pindah Halaman / Ubah ukuran Halaman
        if (fieldId === 'custpage_page_select' || fieldId === 'custpage_page_size') {
            
            // PENTING: Sapu bersih sebelum pindah halaman!
            syncCurrentPageToMemory(rec);
            
            let selectedPage = rec.getValue({ fieldId: 'custpage_page_select' });
            let pageSize = parseInt(rec.getValue({ fieldId: 'custpage_page_size' }));
            let selectedIds = rec.getValue({ fieldId: 'custpage_selected_ids' });

            let currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('page', selectedPage);
            currentUrl.searchParams.set('pagesize', pageSize);
            currentUrl.searchParams.set('selectedids', selectedIds); // Bawa memori ke URL baru

            window.onbeforeunload = null; 
            window.location.href = currentUrl.toString();
        }
        
        // Pilihan Individual Checkbox (Untuk responsivitas UI saja)
        if (context.sublistId === 'custpage_recon_list' && context.fieldId === 'custpage_checkbox_select') {
            syncCurrentPageToMemory(rec);
        }
    };

    // 4. PENTING: Event saat tombol 'Submit Process' ditekan di Suitelet
    const saveRecord = (context) => {
        let rec = context.currentRecord;
        // Sapu bersih sekali lagi agar tombol 'Mark All' yang ditekan tepat sebelum submit ikut terbaca
        syncCurrentPageToMemory(rec); 
        return true; 
    };

    // 5. Tombol Back
    function goBackToUpload() {
        let currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('step');
        currentUrl.searchParams.delete('fileId');
        currentUrl.searchParams.delete('page');
        currentUrl.searchParams.delete('bank');
        currentUrl.searchParams.delete('method');
        currentUrl.searchParams.delete('selectedids'); 
        currentUrl.searchParams.delete('startdate'); 
        currentUrl.searchParams.delete('enddate'); 
        
        window.onbeforeunload = null;
        window.location.href = currentUrl.toString();
    }

    return {
        pageInit: pageInit,
        fieldChanged: fieldChanged,
        saveRecord: saveRecord, // Mendaftarkan fungsi saveRecord
        goBackToUpload: goBackToUpload,
        applyFilter: applyFilter
    };
});