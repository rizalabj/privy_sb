/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', './abj_utils_privy_create_integration_log_record', 'N/runtime', 'N/format'], (record, integrationLogRecord, runtime, format) => {

    const generateResponse = ({ statusParam, message, invoiceNumber, id }) => {
        let statusCode = statusParam ? 200 : 400;
        let status = statusParam ? "success" : "failed";
        return {
            "status_code": statusCode,
            "status": status,
            "message": message,
            "data": {
                "invoice_number": invoiceNumber || "",
                "internal_id": id || ""
            }
        };
    };

    const setFieldValue = (rec, fieldId, value) => {
        rec.setValue({
            fieldId: fieldId,
            value: value
        });
    };

    const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

   
    const setIfExists = (rec, payload, key, fieldId, transformFn = null) => {
        if (hasKey(payload, key)) {
            const val = transformFn ? transformFn(payload[key]) : payload[key];
            setFieldValue(rec, fieldId, val);
        }
    };

    // Helper untuk pasangan flag + date:
    // - Jika flag tidak dikirim -> keduanya dilewati (tidak berubah)
    // - Jika flag true -> set flag true & set date dari payload
    // - Jika flag false -> set flag false & kosongkan date (null)
    const setFlagWithDate = (rec, payload, flagKey, flagFieldId, dateKey, dateFieldId) => {
        if (hasKey(payload, flagKey)) {
            const isChecked = Boolean(payload[flagKey]);
            setFieldValue(rec, flagFieldId, isChecked);
            setFieldValue(rec, dateFieldId, isChecked ? parseISODate(payload[dateKey]) : null);
        }
    };

    const parseISODate = (isoString) => {
        if (!isoString) {
            return '';
        }

        const datePart = String(isoString).split('T')[0];
        const parts = datePart.split('-');

        if (parts.length !== 3) {
            return '';
        }

        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        return new Date(year, month, day, 0, 0, 0, 0);
    };

    const updateInvoiceRecord = (data) => {
        try {
            if (data.transaction_type !== 'invoice') {
                return {
                    status: false,
                    message: 'Invalid transaction type. Only "invoice" is allowed.',
                    id: null
                };
            }
            if (!data?.data?.invoice_internal_id) {
                return {
                    status: false,
                    message: 'invoice_internal_id is required for update invoice.',
                    id: null
                };
            }

            const payload = data.data;

            let rec = record.load({
                type: record.Type.INVOICE,
                id: payload.invoice_internal_id,
                isDynamic: true
            });

            log.debug('Invoice Data Payload', payload);

            setFlagWithDate(rec, payload, 'sign', 'custbody_abj_sign', 'sign_date', 'custbody_abj_sign_date');
            setFlagWithDate(rec, payload, 'tax_invoice', 'custbody_abj_tax_invoice', 'tax_invoice_date', 'custbody_abj_tax_invoice_date');
            setFlagWithDate(rec, payload, 'soft_file', 'custbody_abj_soft_file', 'soft_file_date', 'custbody_abj_soft_file_date');

            setIfExists(rec, payload, 'send_date_by_email', 'custbody_abj_sendbyemail', parseISODate);

            log.debug('saving', 'progress');
            let recId = rec.save();
            log.debug('saving', 'done ' + recId);

            return {
                status: true,
                message: 'Invoice updated successfully.',
                id: recId
            };
        } catch (error) {
            log.error('error', error);
            log.error('Error Update Invoice', error.message);
            if (error.name === 'RCRD_HAS_BEEN_CHANGED') {
                return {
                    status: true,
                    message: 'Invoice updated successfully.',
                    id: data.data.invoice_internal_id
                };
            }

            return {
                status: false,
                message: error.message,
                id: null
            };
        }
    };

    const put = (context) => {
        log.debug('context', context);

        let invoiceUpdate = updateInvoiceRecord(context);
        log.debug('invoiceUpdate', invoiceUpdate);

        let response = generateResponse({
            statusParam: invoiceUpdate.status,
            message: invoiceUpdate.message,
            invoiceNumber: context?.data?.invoice_number,
            id: invoiceUpdate.id
        });

        try {
            var integrationLogRecordId = context.log_id || null;
            const scriptObj = runtime.getCurrentScript();
            var scriptId = scriptObj.id;
            var deploymentId = scriptObj.deploymentId;

            integrationLogRecord.createSOSIntegrationLog({
                jobName: 'ABJ RS | UPDATE INVOICE',
                jobType: 'Restlet - PUT',
                jobLink: 'JOB LINK - URL UPDATE INVOICE',
                reqBody: JSON.stringify(context),
                resBody: JSON.stringify(response),
                linkTrx: invoiceUpdate.id,
                status: invoiceUpdate.status,
                logId: integrationLogRecordId,
                scriptId: scriptId,
                deploymentId: deploymentId,
                tranETPNumber: context?.data?.tran_etp || ''
            });
        } catch (logError) {
            log.error('Failed to create integration log', logError.message);
        }
        return response;
    };

    return {
        put
    };
});