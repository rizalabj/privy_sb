/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', './abj_utils_privy_create_integration_log_record', 'N/runtime', 'N/format'], (record, integrationLogRecord, runtime, format) => {

    const generateResponse = ({statusParam, message, invoiceNumber, id}) => {
        let statusCode = statusParam ? 200 : 400;
        let status = statusParam ? "success" : "failed";
        return {
            "status_code": statusCode,
            "status": status,
            "message": message,
            "data": {
                "invoice_number": invoiceNumber || "",
                "internal_id" : id || ""
            }
        }
    }

    const setFieldValue = (rec, fieldId, value) => {
        rec.setValue({
            fieldId : fieldId,
            value : value
        })
    }

    // Helper untuk parsing ISO date format dari JSON ke JS Date object
    const parseISODate = (isoString) => {
        if(!isoString || isoString == undefined || isoString == null || isoString == ''){
            return '';
        }
        return new Date(isoString);
    }

    const updateInvoiceRecord = (data) => {
        try {
            if(data.transaction_type !== 'invoice'){
                return {
                    status: false,
                    message: 'Invalid transaction type. Only "invoice" is allowed.',
                    id: null
                }
            }
            if(!data?.data?.invoice_internal_id){
                return {
                    status: false,
                    message: 'invoice_internal_id is required for update invoice.',
                    id: null
                }
            }

            // Load Record Invoice
            let rec = record.load({
                type : record.Type.INVOICE,
                id : data.data.invoice_internal_id,
                isDynamic: true
            });

            log.debug('Invoice Data Payload', data.data);

            
            setFieldValue(rec, 'custbody_abj_sign', data.data.sign);
            setFieldValue(rec, 'custbody_abj_tax_invoice', data.data.tax_invoice);
            setFieldValue(rec, 'custbody_abj_soft_file', data.data.soft_file);
            setFieldValue(rec, 'custbody_abj_sendbyemail', data.data.send_date_by_email);
            if(data.data.sign){
                setFieldValue(rec, 'custbody_abj_sign_date', parseISODate(data.data.sign_date));
            }else{
                setFieldValue(rec, 'custbody_abj_sign_date', null);
            }
            if(data.data.tax_invoice){
                setFieldValue(rec, 'custbody_abj_tax_invoice_date', parseISODate(data.data.tax_invoice_date));
            }else{
                setFieldValue(rec, 'custbody_abj_tax_invoice_date', null);
            }
            if(data.data.soft_file){
                setFieldValue(rec, 'custbody_abj_soft_file_date', parseISODate(data.data.soft_file_date));
            }else{
                setFieldValue(rec, 'custbody_abj_soft_file_date', null);
            }
            

            log.debug('saving', 'progress');
            let recId = rec.save();
            log.debug('saving', 'done ' + recId);

            return {
                status : true,
                message : 'Invoice updated successfully.',
                id : recId
            }
        } catch (error) {
            log.error('Error Update Invoice', error.message);
            return {
                status : false,
                message : error.message,
                id : null
            }
        }
    }

    const put = (context) => {
        log.debug('context', context);

        let invoiceUpdate = updateInvoiceRecord(context);
        log.debug('invoiceUpdate', invoiceUpdate);

        let response = generateResponse({ 
            statusParam : invoiceUpdate.status, 
            message : invoiceUpdate.message,
            invoiceNumber : context?.data?.invoice_number,
            id : invoiceUpdate.id
        });

        // Create Integration Log Record
        try {
            var integrationLogRecordId = context.log_id || null;
            const scriptObj = runtime.getCurrentScript();
            var scriptId = scriptObj.id;
            var deploymentId = scriptObj.deploymentId;
            
            const integrationLogRec = integrationLogRecord.createSOSIntegrationLog({
                jobName: 'ABJ RS | UPDATE INVOICE',
                jobType: 'Restlet - PUT',
                jobLink: 'JOB LINK - URL UPDATE INVOICE',
                reqBody: JSON.stringify(context),
                resBody: JSON.stringify(response),
                linkTrx: invoiceUpdate.id,
                status : invoiceUpdate.status,
                logId : integrationLogRecordId,
                scriptId : scriptId,
                deploymentId : deploymentId,
                tranETPNumber : context?.data?.tran_etp || ''
            });
        } catch (logError) {
            log.error('Failed to create integration log', logError.message);
        }
        IA/SOS0003122


        return response;
    }

    // const post = (context) => {
    //     // Mengarahkan POST ke logika PUT karena format request-nya sama
    //     return put(context);
    // }

    return { 
        put
    };
});