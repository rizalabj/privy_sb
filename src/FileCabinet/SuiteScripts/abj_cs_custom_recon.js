/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {

    const pageInit = (context) => {
        // Pastikan jQuery tersedia (standar UI NetSuite)
        // let table = document.getElementById('custpage_recon_list_splits');
        // console.log('table', table);
        // console.log('typeof jQuery', typeof jQuery);
        // if (typeof jQuery !== 'undefined') {
            
        //     // Tentukan warna (Hex Code)
        //     const colorLeftHeader = '#dbeafe';  // Biru untuk Header NetSuite
        //     const colorLeftBody = '#f0f8ff';    // Biru sangat muda untuk Data NetSuite
            
        //     const colorRightHeader = '#fef08a'; // Kuning/Oranye untuk Header CSV Upload
        //     const colorRightBody = '#fffaf0';   // Kuning sangat muda untuk Data CSV Upload

        //     let leftColIndexes = [];
        //     let rightColIndexes = [];

        //     // 1. Deteksi index kolom berdasarkan ID header
        //     jQuery('.uir-list-header-td').each(function(index) {
        //         let cellId = jQuery(this).attr('id') || '';
                
        //         if (cellId.includes('custpage_inv_')) {
        //             leftColIndexes.push(index);
        //             // Warnai Header Kiri
        //             jQuery(this).css('background-color', colorLeftHeader).css('border-bottom', '2px solid #3b82f6');
        //         } 
        //         else if (cellId.includes('custpage_set_')) {
        //             rightColIndexes.push(index);
        //             // Warnai Header Kanan
        //             jQuery(this).css('background-color', colorRightHeader).css('border-bottom', '2px solid #eab308');
        //         }
        //     });

        //     // 2. Warnai semua baris data di bawahnya sesuai index kolom yang ditemukan
        //     jQuery('.uir-list-row-tr').each(function() {
        //         let cells = jQuery(this).children('td');
                
        //         // Set warna untuk sel kolom kiri
        //         leftColIndexes.forEach(idx => {
        //             if(cells[idx]) jQuery(cells[idx]).css('background-color', colorLeftBody);
        //         });
                
        //         // Set warna untuk sel kolom kanan
        //         rightColIndexes.forEach(idx => {
        //             if(cells[idx]) jQuery(cells[idx]).css('background-color', colorRightBody);
        //         });
        //     });
        // }
    };

    const fieldChanged = (context) => {
        const { fieldId, currentRecord } = context;

        // Jika yang diubah adalah dropdown halaman
        if (fieldId === 'custpage_page_select' || fieldId === 'custpage_page_size') {
            let selectedPage = currentRecord.getValue({ fieldId: 'custpage_page_select' });
            let pageSize = parseInt(currentRecord.getValue({ fieldId: 'custpage_page_size' })) || PAGE_SIZE;

            // Mengambil URL halaman saat ini
            let currentUrl = new URL(window.location.href);
            
            // Set atau update parameter 'page' dengan halaman yang baru dipilih
            currentUrl.searchParams.set('page', selectedPage);
            currentUrl.searchParams.set('pagesize', pageSize);

            // Bypass peringatan default browser "Changes you made may not be saved"
            window.onbeforeunload = null; 
            // if (typeof setWindowChanged !== 'undefined') {
            //     setWindowChanged(window, false);
            // }

            // Reload halaman dengan parameter baru
            window.location.href = currentUrl.toString();
        }
    };


    function goBackToUpload() {
        let currentUrl = new URL(window.location.href);
        // Bersihkan parameter preview agar kembali ke mode upload (awal)
        currentUrl.searchParams.delete('step');
        currentUrl.searchParams.delete('fileId');
        currentUrl.searchParams.delete('page');
        currentUrl.searchParams.delete('bank');
        currentUrl.searchParams.delete('method');
        
        if (typeof setWindowChanged !== 'undefined') {
            setWindowChanged(window, false);
        }
        
        window.location.href = currentUrl.toString();
    }

    return {
        fieldChanged: fieldChanged,
        goBackToUpload : goBackToUpload
    };
});