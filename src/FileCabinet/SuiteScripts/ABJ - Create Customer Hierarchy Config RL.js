/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/record', 'N/log', 'N/error', 'N/format', 'N/search', 'N/runtime', 'N/query'], (record, log, error, format, search, runtime, query) => {

    function createLog(req, resp, trx, status, refnumber, isDataWH) {
        var recLog = record.create({
            type: 'customtransaction_abj_log_integratio'
        })
        const scriptObj = runtime.getCurrentScript()
        var scriptId = scriptObj.id
        var deploymentId = scriptObj.deploymentId

        recLog.setValue('custbody_abj_integlog_job_name', 'ABJ RS | CREATE CUST HIERARCHY CONFIGURE')
        recLog.setValue('custbody_abj_integlog_job_type', 'Restlet - POST')
        recLog.setValue('custbody_abj_integlog_job_link', 'URL Endpoint')
        recLog.setValue('custbody_abj_integlog_request_body', req)
        recLog.setValue('custbody_abj_integlog_response_body', resp)
        // recLog.setValue('custbody_abj_integlog_trx_number', trx)
        recLog.setValue('custbody_abj_integlog_cust_hie_config', trx)
        recLog.setValue('custbody_abj_integlog_status', status)
        recLog.setValue('custbody_abj_usage_ref_number', refnumber)
        recLog.setValue('custbody_abj_integlog_isdatawarehouse', isDataWH)
        recLog.setValue('custbody_abj_integlog_script_id', scriptId)
        recLog.setValue('custbody_abj_integlog_deploy_script_id', deploymentId)

        var recLogSave = recLog.save()
        log.debug('recLogSave', recLogSave)
    }

    function getEmployee(privy_id){
        var searchEmployee = search.create({
            type: 'employee',
            filters: [
                ['custentity_abj_privy_id', 'is', privy_id]
            ],
            columns: [
                'internalid', 'entityid'
            ]
        })
        var searchEmployeeRun = searchEmployee.run().getRange(0, 1)
        if (searchEmployeeRun.length > 0) {
            log.debug('searchEmployeeRun', searchEmployeeRun);
            var employee_id = searchEmployeeRun[0].getValue('internalid');
            return employee_id
        }else{
            return null
        }
    }

    return {
        post: (context) => {
            var refNum = context.data.ref_number
            var npwp = context.data.npwp
            var isDataWH = context.data.is_data_warehouse

            var respData = {
                ref_number: refNum,
                internal_id: null
            }

            var isNewRefNum = false
            var isNewNPWP = false

            try {
                //validasi transaction type
                if (!context.record_type || context.record_type != 'customer_hierarchy_configuration') {
                    throw ({
                        message: 'This endpoint only accepts record_type: customer_hierarchy_configuration'
                    });
                }

                //validasi ref_num
                var searchRefNum = search.create({
                    type: 'customrecord_abj_customer_hierar_config',
                    filters: [
                        ['custrecord_abj_ref_number_config', 'is', refNum]
                    ],
                    columns: [
                        'custrecord_abj_ref_number_config'
                    ]
                })
                var searchRefNumResult = searchRefNum.run().getRange(0, 1)
                if (searchRefNumResult.length > 0) {
                    throw ({
                        message: 'Ref Number: ' + refNum + ' is already exist'
                    });
                } else {
                    isNewRefNum = true
                }

                if (isNewRefNum == true) {
                    var customer_hierarchy_id = context.data.customer_hierarchy_id
                    var integration_type_id = context.data.integration_type_id
                    var billing_term_id = context.data.billing_term_id
                    var address_label = context.data.address_label
                    var sreet_address = context.data.sreet_address
                    var city_id = context.data.city_id
                    var zip_code = context.data.zip_code
                    var pic_name = context.data.pic_name
                    var job_title = context.data.job_title
                    var phone_number_pic = context.data.phone_number_pic
                    var email_to_pic = context.data.email_to_pic
                    var finance1_name = context.data.finance1_name
                    var finance1_phone = context.data.finance1_phone
                    var finance1_email_to = context.data.finance1_email_to
                    var finance2_name = context.data.finance2_name
                    var finance2_phone = context.data.finance2_phone
                    var finance2_email_to = context.data.finance2_email_to
                    var finance3_name = context.data.finance3_name
                    var finance3_phone = context.data.finance3_phone
                    var finance3_email_to = context.data.finance3_email_to
                    var hunter = context.data.hunter
                    var farmer = context.data.farmer
                    var ebs = context.data.ebs
                    var bdm = context.data.bdm
                    var vp_business_development = context.data.vp_business_development
                    var revenue_operations = context.data.revenue_operations
                    var revenue_operations_manager = context.data.revenue_operations_manager
                    var vp_revenue_operations = context.data.vp_revenue_operations
                    var value_engineering = context.data.value_engineering
                    var value_engineering_manager = context.data.value_engineering_manager
                    var vp_value_engineering = context.data.vp_value_engineering
                    var invoice_type_id = context.data.invoice_type_id
                    var term_id = context.data.term_id
                    var ppn_report_id = context.data.ppn_report_id
                    var lead_type_id = context.data.lead_type_id
                    var lead_source_id = context.data.lead_source_id
                    var is_management_account = context.data.is_management_account

                    //validation
                    if (!customer_hierarchy_id || customer_hierarchy_id == '' || customer_hierarchy_id == null) {
                        throw ({
                            message: 'customer_hierarchy_id is required',
                        });
                    }
                    var customer_id = null;
                    var searchCustomerHier = search.create({
                        type: 'customrecord_abj_privy_cust_hierarchy',
                        filters: [
                            ['internalid', 'is', Number(customer_hierarchy_id)]
                        ],
                        columns: [
                            'name', 'custrecord_abj_customer_link'
                        ]
                    })
                    var searchCustomerHierRun = searchCustomerHier.run().getRange(0, 1)
                    if (searchCustomerHierRun.length > 0) {
                        customer_id = searchCustomerHierRun[0].getValue('custrecord_abj_customer_link');
                    } else {
                        throw ({
                            message: 'Customer Hierarchy with id ' + customer_hierarchy_id + ' was not found',
                        });
                    }

                    if (!integration_type_id || integration_type_id == '' || integration_type_id == null) {
                        throw ({
                            message: 'integration_type_id is empty'
                        });
                    } else {
                        var searchIntegrationType = search.create({
                            type: 'customlist_privy_integrasi_list',
                            filters: [
                                ['internalid', 'is', integration_type_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchIntegrationTypeRun = searchIntegrationType.run().getRange(0, 1)
                        if (searchIntegrationTypeRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Integration Type with id ' + integration_type_id + ' was not found',
                            });
                        }
                    }

                    if (!billing_term_id || billing_term_id == '' || billing_term_id == null) {
                        throw ({
                            message: 'billing_term_id is empty'
                        });
                    } else {
                        var searchBillingTerm = search.create({
                            type: 'customlist_abj_billing_terms_list',
                            filters: [
                                ['internalid', 'is', billing_term_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchBillingTermRun = searchBillingTerm.run().getRange(0, 1)
                        if (searchBillingTermRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Billing Term with id ' + billing_term_id + ' was not found',
                            });
                        }
                    }

                    if (!address_label || address_label == '' || address_label == null) {
                        throw ({
                            message: 'address_label is mandatory'
                        });
                    }

                    if (!city_id || city_id == '' || city_id == null) {
                        throw ({
                            message: 'city_id is empty'
                        });
                    } else {
                        var searchBillingTerm = search.create({
                            type: 'customlist_abj_billing_terms_list',
                            filters: [
                                ['internalid', 'is', city_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchBillingTermRun = searchBillingTerm.run().getRange(0, 1)
                        if (searchBillingTermRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'City with id ' + city_id + ' was not found',
                            });
                        }
                    }

                    var hunter_id = null;
                    if (hunter != '' || hunter != null) {
                        hunter_id = getEmployee(hunter)
                        if (hunter_id == null ){
                            throw ({
                                message: 'Hunter with id ' + hunter + ' was not found',
                            });
                        }
                    }

                    var farmer_id = null;
                    if (farmer != '' || farmer != null) {
                        farmer_id = getEmployee(farmer)
                        if (farmer_id == null ){
                            throw ({
                                message: 'Farmer with id ' + farmer + ' was not found',
                            });
                        }
                    }

                    var ebs_id = null;
                    if (ebs != '' || ebs != null) {
                        ebs_id = getEmployee(ebs)
                        if (ebs_id == null ){
                            throw ({
                                message: 'EBS with id ' + ebs + ' was not found',
                            });
                        }
                    }

                    var bdm_id = null;
                    if (bdm != '' || bdm != null) {
                        bdm_id = getEmployee(bdm)
                        if (bdm_id == null ){
                            throw ({
                                message: 'BDM with id ' + bdm + ' was not found',
                            });
                        }
                    }

                    var vp_business_development_id = null;
                    if (vp_business_development != '' || vp_business_development != null) {
                        vp_business_development_id = getEmployee(vp_business_development)
                        if (vp_business_development_id == null ){
                            throw ({
                                message: 'VP Business Development with id ' + vp_business_development + ' was not found',
                            });
                        }
                    }

                    var revenue_operations_id = null;
                    if (revenue_operations != '' || revenue_operations != null) {
                        revenue_operations_id = getEmployee(revenue_operations)
                        if (revenue_operations_id == null ){
                            throw ({
                                message: 'Revenue Operations with id ' + revenue_operations + ' was not found',
                            });
                        }
                    }

                    var revenue_operations_manager_id = null;
                    if (revenue_operations_manager != '' || revenue_operations_manager != null) {
                        revenue_operations_manager_id = getEmployee(revenue_operations_manager)
                        if (revenue_operations_manager_id == null ){
                            throw ({
                                message: 'Revenue Operations Manager with id ' + revenue_operations_manager + ' was not found',
                            });
                        }
                    }

                    var vp_revenue_operations_id = null;
                    if (vp_revenue_operations != '' || vp_revenue_operations != null) {
                        vp_revenue_operations_id = getEmployee(vp_revenue_operations)
                        if (vp_revenue_operations_id == null ){
                            throw ({
                                message: 'VP Revenue Operations with id ' + vp_revenue_operations + ' was not found',
                            });
                        }
                    }

                    var value_engineering_id = null;
                    if (value_engineering != '' || value_engineering != null) {
                        value_engineering_id = getEmployee(value_engineering)
                        if (value_engineering_id == null ){
                            throw ({
                                message: 'VP Revenue Operations with id ' + value_engineering + ' was not found',
                            });
                        }
                    }

                    var value_engineering_manager_id = null;
                    if (value_engineering_manager != '' || value_engineering_manager != null) {
                        value_engineering_manager_id = getEmployee(value_engineering_manager)
                        if (value_engineering_manager_id == null ){
                            throw ({
                                message: 'VP Revenue Operations with id ' + value_engineering_manager + ' was not found',
                            });
                        }
                    }

                    var vp_value_engineering_id = null;
                    if (vp_value_engineering != '' || vp_value_engineering != null) {
                        vp_value_engineering_id = getEmployee(vp_value_engineering)
                        if (vp_value_engineering_id == null ){
                            throw ({
                                message: 'VP Revenue Operations with id ' + vp_value_engineering + ' was not found',
                            });
                        }
                    }

                    if (!term_id || term_id == '' || term_id == null) {
                        throw ({
                            message: 'term_id is empty'
                        });
                    } else {
                        var searchTerm = search.create({
                            type: 'term',
                            filters: [
                                ['internalid', 'is', term_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchTermRun = searchTerm.run().getRange(0, 1)
                        if (searchTermRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Term with id ' + term_id + ' was not found',
                            });
                        }
                    }

                    if (!ppn_report_id || ppn_report_id == '' || ppn_report_id == null) {
                        throw ({
                            message: 'ppn_report_id is empty'
                        });
                    } else {
                        var searchPpnReport = search.create({
                            type: 'customlist_abj_ppn_report',
                            filters: [
                                ['internalid', 'is', ppn_report_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchPpnReportRun = searchPpnReport.run().getRange(0, 1)
                        if (searchPpnReportRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'PPN Report with id ' + ppn_report_id + ' was not found',
                            });
                        }
                    }

                    if (!lead_type_id || lead_type_id == '' || lead_type_id == null) {
                        throw ({
                            message: 'lead_type_id is empty'
                        });
                    } else {
                        var searchLeadType = search.create({
                            type: 'customlist_abj_lead_type',
                            filters: [
                                ['internalid', 'is', lead_type_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchLeadTypeRun = searchLeadType.run().getRange(0, 1)
                        if (searchLeadTypeRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Lead Type with id ' + lead_type_id + ' was not found',
                            });
                        }
                    }

                    if (!lead_source_id || lead_source_id == '' || lead_source_id == null) {
                        throw ({
                            message: 'lead_source_id is empty'
                        });
                    } else {
                        var searchLeadSource = search.create({
                            type: 'customlistcustlist_leadsource',
                            filters: [
                                ['internalid', 'is', lead_source_id]
                            ],
                            columns: [
                                'name'
                            ]
                        })
                        var searchLeadSourceRun = searchLeadSource.run().getRange(0, 1)
                        if (searchLeadSourceRun.length > 0) {
                            //
                        } else {
                            throw ({
                                message: 'Lead Source with id ' + lead_source_id + ' was not found',
                            });
                        }
                    }

                    //create record
                    var rec = record.create({
                        type: 'customrecord_abj_customer_hierar_config'
                    })
                    rec.setValue({ fieldId: 'customform', value: 29 }) // 29	Privy Customer Hierarchy Configuration Form
                    rec.setValue({ fieldId: 'custrecord_abj_id_customer', value: customer_id })
                    rec.setValue({ fieldId: 'custrecord_abj_customer_link_config', value: customer_hierarchy_id })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_integration_type', value: integration_type_id })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_billing_term', value: billing_term_id })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_label_address', value: address_label })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_street_address', value: sreet_address })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_city', value: city_id })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_zip_code', value: zip_code })
                    rec.setValue({ fieldId: 'custrecord_abj_primary_contact_name', value: pic_name })
                    rec.setValue({ fieldId: 'custrecord_abj_job_title', value: job_title })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_config_pic_phone', value: phone_number_pic })
                    rec.setValue({ fieldId: 'custrecord_abj_hie_con_email_to', value: email_to_pic })
                    rec.setValue({ fieldId: 'custrecord_abj_finance_name_1', value: finance1_name })
                    rec.setValue({ fieldId: 'custrecord_abj_finance_phone1', value: finance1_phone })
                    rec.setValue({ fieldId: 'custrecord_abj_email_to_2', value: finance1_email_to })
                    rec.setValue({ fieldId: 'custrecord_abj_finance_name_2', value: finance2_name })
                    rec.setValue({ fieldId: 'custrecord_abj_finance_phone2', value: finance2_phone })
                    rec.setValue({ fieldId: 'custrecord_abj_email_to_3', value: finance2_email_to })
                    rec.setValue({ fieldId: 'custrecord_abj_finance_name_3', value: finance3_name })
                    rec.setValue({ fieldId: 'custrecord_abj_phone_3', value: finance3_phone })
                    rec.setValue({ fieldId: 'custrecord_abj_email_to_4', value: finance3_email_to })
                    rec.setValue({ fieldId: 'custrecord_abj_config_hunter', value: hunter_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_farmer', value: farmer_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_ebs', value: ebs_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_bdm', value: bdm_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_vp_buss_dev', value: vp_business_development_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_rev_ops', value: revenue_operations_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_ops_mgr', value: revenue_operations_manager_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_vp_rev_ops', value: vp_revenue_operations_id })
                    rec.setValue({ fieldId: 'custrecord_abj_config_value_eng', value: value_engineering_id })
                    rec.setValue({ fieldId: 'custrecord_abj_value_eng_mgr', value: value_engineering_manager_id })
                    rec.setValue({ fieldId: 'custrecord_abj_term_of_payment_', value: term_id })
                    rec.setValue({ fieldId: 'custrecord_abj_ppn_report_', value: ppn_report_id })
                    rec.setValue({ fieldId: 'custrecord_abj_invoice_type_', value: invoice_type_id })
                    rec.setValue({ fieldId: 'custrecord_abj_cust_lead_', value: lead_type_id })
                    rec.setValue({ fieldId: 'custrecord_abj_lead_source_', value: lead_source_id })
                    rec.setValue({ fieldId: 'custrecord_abj_ref_number_config', value: refNum })
                    if (is_management_account == true) {
                        rec.setValue({ fieldId: 'custrecord_abj_hie_client_flag_', value: true })
                    }

                    var recSave = rec.save()
                    log.debug('recSave', recSave)
                    if (recSave) {
                        var reqBody = JSON.stringify(context, null, 2)
                        // reqBody = reqBody.replace(/ /g, '\u00A0');
                        var respBody = {
                            "status_code": 200,
                            "status": "success",
                            "message": "Customer Hierarchy Configuration created successfully.",
                            "data": {
                                "ref_number": refNum,
                                "internal_id": recSave
                            }
                        }

                        // var respBodyText = JSON.stringify(respBody, null, 2).replace(/ /g, '\u00A0');
                        var respBodyText = JSON.stringify(respBody, null, 2)

                        //create log
                        createLog(reqBody, respBodyText, recSave, true, refNum, isDataWH)

                        return respBody
                    }

                }

            } catch (error) {
                log.debug('error', error.message)

                var reqBodyError = JSON.stringify(context, null, 2)
                // reqBodyError = reqBodyError.replace(/\r\n/g, '\n');
                // reqBodyError = reqBodyError.replace(/ /g, '\u00A0');

                var respBodyError = {
                    "status_code": 400,
                    "status": "Failed",
                    "message": error.message,
                    "data": respData
                }
                // var respBodyErrorText = JSON.stringify(respBodyError, null, 2).replace(/ /g, '\u00A0');
                var respBodyErrorText = JSON.stringify(respBodyError, null, 2)

                //create log
                createLog(reqBodyError, respBodyErrorText, null, false, refNum, isDataWH)

                return respBodyError
            }
        }
    };

});
