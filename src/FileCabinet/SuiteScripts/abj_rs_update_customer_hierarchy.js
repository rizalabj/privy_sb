/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */


define(['N/record', 'N/log', 'N/error', 'N/format', 'N/search', 'N/runtime', 'N/query'], (record, log, error, format, search, runtime, query) => {

    function createLog(req, resp, trx, status, refnumber, isDataWH, methodType) {
        var recLog = record.create({
            type: 'customtransaction_abj_log_integratio'
        })
        const scriptObj = runtime.getCurrentScript()
        var scriptId = scriptObj.id
        var deploymentId = scriptObj.deploymentId

        recLog.setValue('custbody_abj_integlog_job_name', 'ABJ RS | UPDATE CUST HIERARCHY')
        recLog.setValue('custbody_abj_integlog_job_type', methodType || 'Restlet - POST')
        recLog.setValue('custbody_abj_integlog_job_link', 'URL Endpoint')
        recLog.setValue('custbody_abj_integlog_request_body', req)
        recLog.setValue('custbody_abj_integlog_response_body', resp)
        recLog.setValue('custbody_abj_integlog_cust_hierarchy', trx)
        recLog.setValue('custbody_abj_integlog_status', status)
        recLog.setValue('custbody_abj_usage_ref_number', refnumber)
        recLog.setValue('custbody_abj_integlog_isdatawarehouse', isDataWH)
        recLog.setValue('custbody_abj_integlog_script_id', scriptId)
        recLog.setValue('custbody_abj_integlog_deploy_script_id', deploymentId)

        var recLogSave = recLog.save()
        log.debug('recLogSave', recLogSave)
    }

    return {
        put: (context) => {
            var recId = context.data.rec_id; // Using rec_id for the lookup
            var refNum = context.data.ref_number;
            var isDataWH = context.data.is_data_warehouse;

            var respData = {
                ref_number: refNum,
                internal_id: recId || null
            }

            try {
                // validate transaction type
                if (!context.record_type || context.record_type != 'customer_hierarchy') {
                    throw ({
                        message: 'This endpoint only accepts record_type: customer_hierarchy'
                    });
                }

                if (!recId) {
                    throw ({
                        message: 'rec_id is required for updating the record.'
                    });
                }

                // Load the existing record directly using rec_id
                // Note: If recId is invalid, NetSuite will throw an error automatically which gets caught below
                var rec = record.load({
                    type: 'customrecord_abj_privy_cust_hierarchy',
                    id: recId
                });

                // If ref_number isn't in the payload, fetch the existing one for our logs & response
                if (!refNum) {
                    refNum = rec.getValue({ fieldId: 'custrecord_abj_ref_number' });
                    respData.ref_number = refNum;
                }

                // Extract all possible fields to update
                var customer_id = context.data.customer_id
                var level_type_id = context.data.level_type_id
                var enterprise_id = context.data.enterprise_id
                var enterprise_name = context.data.enterprise_name
                var merchant_id = context.data.merchant_id
                var merchant_name = context.data.merchant_name
                var application_id = context.data.application_id
                var application_name = context.data.application_name
                var channel_id = context.data.channel_id
                var channel_name = context.data.channel_name
                var enterprise_id_hierarchy = context.data.enterprise_id_hierarchy
                var merchant_id_hierarchy = context.data.merchant_id_hierarchy
                var application_id_hierarchy = context.data.application_id_hierarchy
                var key_account = context.data.key_account

                // Set values ONLY if they are provided in the payload (allows partial updates)
                if (context.data.ref_number !== undefined) rec.setValue({ fieldId: 'custrecord_abj_ref_number', value: context.data.ref_number })
                if (customer_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_customer_link', value: customer_id })
                if (level_type_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_level_type', value: level_type_id })
                if (enterprise_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_enterprise_id', value: enterprise_id })
                if (enterprise_name !== undefined) rec.setValue({ fieldId: 'custrecord_abj_enterprise_name', value: enterprise_name })
                if (merchant_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_merchant_id', value: merchant_id })
                if (merchant_name !== undefined) rec.setValue({ fieldId: 'custrecord_abj_merchant_name', value: merchant_name })
                if (application_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_application_id', value: application_id })
                if (application_name !== undefined) rec.setValue({ fieldId: 'custrecord_abj_application_name', value: application_name })
                if (channel_id !== undefined) rec.setValue({ fieldId: 'custrecord_abj_channel_id', value: channel_id })
                if (channel_name !== undefined) rec.setValue({ fieldId: 'custrecord_abj_channel_name', value: channel_name })
                if (enterprise_id_hierarchy !== undefined) rec.setValue({ fieldId: 'custrecord_hierarchy_enterprise', value: enterprise_id_hierarchy })
                if (merchant_id_hierarchy !== undefined) rec.setValue({ fieldId: 'custrecord_abj_hierarchy_merhant', value: merchant_id_hierarchy })
                if (application_id_hierarchy !== undefined) rec.setValue({ fieldId: 'custrecord_abj_hierarchy_application', value: application_id_hierarchy })
                if (key_account !== undefined) rec.setValue({ fieldId: 'custentity_abj_key_account', value: key_account })

                var recSave = rec.save()
                log.debug('recSave (PUT)', recSave)
                
                if (recSave) {
                    var reqBody = JSON.stringify(context, null, 2)
                    var respBody = {
                        "status_code": 200,
                        "status": "success",
                        "message": "Customer updated successfully.",
                        "data": {
                            "ref_number": refNum,
                            "internal_id": recSave
                        }
                    }

                    var respBodyText = JSON.stringify(respBody, null, 2)
                    createLog(reqBody, respBodyText, recSave, true, refNum, isDataWH, 'Restlet - PUT')

                    return respBody
                }

            } catch (error) {
                log.debug('error (PUT)', error.message)

                var reqBodyError = JSON.stringify(context, null, 2)
                var respBodyError = {
                    "status_code": 400,
                    "status": "Failed",
                    "message": error.message,
                    "data": respData
                }
                
                var respBodyErrorText = JSON.stringify(respBodyError, null, 2)
                createLog(reqBodyError, respBodyErrorText, recId || null, false, refNum, isDataWH, 'Restlet - PUT')

                return respBodyError
            }
        }
    };

});
