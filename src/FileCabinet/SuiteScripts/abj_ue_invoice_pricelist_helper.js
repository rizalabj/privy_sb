/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/log', 'N/record','N/query'], (log, record, query) => {
    const ITEM_SUBLIST_ID = 'item';
    const PRICE_LIST_RECORD_TYPE = 'customrecord_abj_privy_pricelist';

    const PRICE_LIST_FIELD_MAP = {
        customer: 'custrecord_abj_customer_master',
        hierarchyCustomer: 'custrecord_abj_cust_hierarchy',
        isTiering: 'custrecord_abj_is_tiering',
        isAccumulatedTiering: 'custrecord_abj_accumulated_tiering',
        minimumQuantity: 'custrecord_abj_price_min_qty',
        maximumQuantity: 'custrecord_abj_price_max_qty',
        startDate: 'custrecord_abj_price_agree_start_date',
        endDate: 'custrecord_abj_price_agree_end_date',
        item: 'custrecord_abj_item_price_list',
        publishedPrice: 'custrecord_abj_publised_price',
        finalPrice: 'custrecord_abj_price_final_price',
        discountOrPremium: 'custrecord_abj_price_discount_or_premium',
        isMinAchievement: 'custrecord_abj_price_is_min_achieve',
        minAchievement: 'custrecord_abj_minimum_achievement',
        billingType: 'custrecord_abj_billing_type',
        enterpriseSegment: 'cseg_abj_enterprise',
        merchantSegment: 'cseg_abj_merchant',
        applicationSegment: 'cseg_abj_applicatio',
        channelSegment: 'cseg_abj_channel_se',
        isPrepaidOrPostpaid: 'custrecord_abj_prepaid_postpaid'
    };

    const formatDateForSuiteQL = (dateValue) => {
        if (!dateValue) {
        return null;
        }

        const transactionDate = new Date(dateValue);
        if (Number.isNaN(transactionDate.getTime())) {
        return null;
        }

        const year = transactionDate.getFullYear();
        const month = `${transactionDate.getMonth() + 1}`.padStart(2, '0');
        const day = `${transactionDate.getDate()}`.padStart(2, '0');

        return `${year}-${month}-${day}`;
    };

    const toNumberOrNull = (value) => {
        if (value === null || value === undefined || value === '') {
        return null;
        }
        const parsedValue = Number(value);
        return Number.isNaN(parsedValue) ? null : parsedValue;
    };

    // Some SuiteQL drivers return boolean columns as 'T'/'F' strings.
    const toBooleanFlag = (value) => (value === 'T' || value === true || Number(value) === 1 ? 1 : 0);
    const escapeSqlValue = (value) => String(value).replace(/'/g, "''");

    const PREPAID_VALUE = 13;

    const priceListTypeMap = {
      26: 'normal',
      31: 'normalWithAchievement',
      32: 'normalTiering',
      33: 'accumulatedTiering',
      34: 'bundling'
    };

    const mapPriceListRow = (result) => ({
        privyPriceListId: result.id,
        publishedPrice: toNumberOrNull(result.published_price),
        finalPrice: toNumberOrNull(result.final_price),
        discountOrPremium: toNumberOrNull(result.discount_or_premium),
        isTiering: toBooleanFlag(result.is_tiering),
        isAccumulatedTiering: toBooleanFlag(result.is_accumulated_tiering),
        minimumQuantity: toNumberOrNull(result.minimum_quantity),
        maximumQuantity: toNumberOrNull(result.maximum_quantity),
        customform: toNumberOrNull(result.customform),
        type: priceListTypeMap[toNumberOrNull(result.customform)],
        isMinAchievement: toBooleanFlag(result.is_min_achievement),
        minimumAchievement: toNumberOrNull(result.minimum_achievement),
        billingType: result.billing_type,
        billingTypeAccount: result.billing_type_account,
        enterpriseSegment: result.enterprise_segment,
        merchantSegment: result.merchant_segment,
        applicationSegment: result.application_segment,
        channelSegment: result.channel_segment,
        isPrepaidOrPostpaid: Number(result.is_prepaid_or_postpaid) === PREPAID_VALUE ? 'prepaid' : 'postpaid',
        soOneTimeDiscountPerPcs: toNumberOrNull(result.so_one_time_discount_per_pcs),
        soId: toNumberOrNull(result.so_id),
        soLineId: toNumberOrNull(result.so_line_id),
        soTrandate: result.so_trandate,
        // Cumulative qty already used against this specific prepaid bucket, as of
        // the most recent SO line that referenced it (see dedup logic below).
        soQtyUsage: toNumberOrNull(result.so_qty_usage),
        soQty : Math.abs(toNumberOrNull(result.so_qty))
    });

    const buildPriceLookupMap = (customerId, trandate, itemData) => {
        log.debug({
          title: 'buildPriceLookupMap',
          details: { customerId, trandate, itemData }
        });

        if (!customerId || !trandate || itemData.length === 0) {
        return {};
        }

        const escapedCustomerId = escapeSqlValue(customerId);
        const escapedDate = escapeSqlValue(trandate);
        const validItemData = itemData.filter(data => data.itemId && data.customerHierarchyId);
        
        if (validItemData.length === 0) {
            return {};
        }

        // Buat string kondisi gabungan (Item A AND Hierarchy A) OR (Item B AND Hierarchy B)
        const itemHierarchyConditions = validItemData.map(data => {
            const escapedItem = escapeSqlValue(data.itemId);
            const escapedHierarchy = escapeSqlValue(data.customerHierarchyId);
            return `(pl.${PRICE_LIST_FIELD_MAP.item} = '${escapedItem}' AND pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer} = '${escapedHierarchy}')`;
        }).join(' OR ');

        // NOTE: keeping the exact same query shape/interpolation style as the
        // working version - only the customform column selection is fixed.
        const suiteQL = `
        SELECT
            pl.id AS id,
            pl.${PRICE_LIST_FIELD_MAP.item} AS item_id,
            pl.${PRICE_LIST_FIELD_MAP.publishedPrice} AS published_price,
            pl.${PRICE_LIST_FIELD_MAP.finalPrice} AS final_price,
            pl.${PRICE_LIST_FIELD_MAP.discountOrPremium} AS discount_or_premium,
            pl.${PRICE_LIST_FIELD_MAP.isTiering} AS is_tiering,
            pl.${PRICE_LIST_FIELD_MAP.isAccumulatedTiering} AS is_accumulated_tiering,
            pl.${PRICE_LIST_FIELD_MAP.minimumQuantity} AS minimum_quantity,
            pl.${PRICE_LIST_FIELD_MAP.maximumQuantity} AS maximum_quantity,
            '' AS customform,
            pl.${PRICE_LIST_FIELD_MAP.isMinAchievement} AS is_min_achievement,
            pl.${PRICE_LIST_FIELD_MAP.minAchievement} AS minimum_achievement,
            pl.${PRICE_LIST_FIELD_MAP.enterpriseSegment} AS enterprise_segment,
            pl.${PRICE_LIST_FIELD_MAP.merchantSegment} AS merchant_segment,
            pl.${PRICE_LIST_FIELD_MAP.applicationSegment} AS application_segment,
            pl.${PRICE_LIST_FIELD_MAP.channelSegment} AS channel_segment,
            pl.${PRICE_LIST_FIELD_MAP.billingType} AS billing_type,
            pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} AS is_prepaid_or_postpaid,
            pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer} AS custrecord_abj_cust_hierarchy,
            BT.custrecord_abj_rev_rec_account AS billing_type_account
        FROM
            ${PRICE_LIST_RECORD_TYPE} pl
            JOIN classification BT ON BT.id = pl.${PRICE_LIST_FIELD_MAP.billingType}
        WHERE
            pl.${PRICE_LIST_FIELD_MAP.customer} = '${escapedCustomerId}'
            AND pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13
            AND pl.isinactive = 'F'
            AND TO_DATE('${escapedDate}', 'YYYY-MM-DD')
            BETWEEN pl.${PRICE_LIST_FIELD_MAP.startDate}
            AND pl.${PRICE_LIST_FIELD_MAP.endDate}
            AND (${itemHierarchyConditions})
        `;

        log.debug({ title: 'Price List Query', details: suiteQL });

        const resultSet = query.runSuiteQL({ query: suiteQL });
        const mappedResults = resultSet.asMappedResults();

        const bucketMapsByItem = {};

        mappedResults.forEach((result) => {
            const itemId = String(result.item_id);
            const customerHierarchyId = String(result.custrecord_abj_cust_hierarchy);
            const bucketId = result.id;

            if (!bucketMapsByItem[`${itemId}_${customerHierarchyId}`]) {
                bucketMapsByItem[`${itemId}_${customerHierarchyId}`] = new Map();
            }

            bucketMapsByItem[`${itemId}_${customerHierarchyId}`].set(bucketId, mapPriceListRow(result));
        });

        const priceLookupMap = {};
        Object.keys(bucketMapsByItem).forEach((itemId) => {
            priceLookupMap[itemId] = Array.from(bucketMapsByItem[itemId].values());
        });

        return priceLookupMap;
  };

  const resolveAccumulatedTiering = (tiers, quantity) => {
    const sortedTiers = [...tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);

    let totalPrice = 0;
    let discountPremium = 0;

    for (const tier of sortedTiers) {
      const tierLowerBound = tier.minimumQuantity === 0 ? 0 : tier.minimumQuantity - 1;
      const tierUpperBound = tier.maximumQuantity ?? Infinity;
      const tierCapacity = tierUpperBound - tierLowerBound;
      const qtyAboveMin = quantity - tierLowerBound;

      if (qtyAboveMin > 0) {
        const qtyInTier = Math.min(qtyAboveMin, tierCapacity);
        totalPrice += qtyInTier * tier.finalPrice;
        discountPremium += tier.discountOrPremium;
      }
    }

    const averageUnitPrice = quantity > 0 ? totalPrice / quantity : 0;

    return [{ finalPrice: averageUnitPrice, discountOrPremium: discountPremium, privyPriceListId: null }];
  };

  const resolveMatchedPrices = (priceListEntries, quantity) => {
    let matchedPrices = priceListEntries;

    if (matchedPrices.length <= 1) {
      return matchedPrices;
    }

    const minAchievementPrice = matchedPrices.find(
      (price) => price.isMinAchievement === 1 && price.minimumAchievement !== null && quantity >= price.minimumAchievement
    );
    if (minAchievementPrice) {
      matchedPrices = [minAchievementPrice];
    }

    const tieredPrice = matchedPrices.find(
      (price) =>
        price.isTiering === 1 &&
        price.isAccumulatedTiering !== 1 &&
        price.minimumQuantity !== null &&
        price.maximumQuantity !== null &&
        quantity >= price.minimumQuantity &&
        quantity <= price.maximumQuantity
    );
    if (tieredPrice) {
      matchedPrices = [tieredPrice];
    }

    const accumulatedTiers = matchedPrices.filter(
      (price) =>
        price.isTiering === 1 && price.isAccumulatedTiering === 1 && price.minimumQuantity !== null && quantity >= price.minimumQuantity
    );
    if (accumulatedTiers.length > 0) {
      matchedPrices = resolveAccumulatedTiering(accumulatedTiers, quantity);
    }

    return matchedPrices;
  };


  // ---------------------------------------------------------------------
  // Sublist line helpers
  // ---------------------------------------------------------------------

  const captureLineSnapshot = (transactionRecord, sublistId, line) => {
    let fieldIds = [];
    try {
      fieldIds = transactionRecord.getSublistFields({ sublistId });
    } catch (e) {
      log.debug({ title: 'getSublistFields unavailable, using fallback field list', details: String(e) });
      fieldIds = ['item', 'description', 'location', 'department', 'units'];
    }

    const snapshot = {};
    fieldIds.forEach((fieldId) => {
      if (PRICE_LIST_DRIVEN_FIELDS.includes(fieldId)) {
        return; // these are always set explicitly per allocation, don't copy stale values
      }
      try {
        const value = transactionRecord.getSublistValue({ sublistId, fieldId, line });
        if (value !== null && value !== undefined && value !== '') {
          snapshot[fieldId] = value;
        }
      } catch (e) {
        // field not readable in this context - skip silently
      }
    });

    return snapshot;
  };

  const applyLineSnapshot = (transactionRecord, sublistId, line, snapshot) => {
    Object.keys(snapshot).forEach((fieldId) => {
      try {
        transactionRecord.setSublistValue({ sublistId, fieldId, line, value: snapshot[fieldId] });
      } catch (e) {
        log.debug({ title: 'Skip copying field on split line', details: { fieldId, error: String(e) } });
      }
    });
  };

  const applyPriceListValuesToLine = (transactionRecord, line, matchedPrice, allocatedQuantity) => {
    transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'quantity', line, value: allocatedQuantity });
    transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'price', line, value: -1 });

    if (matchedPrice.privyPriceListId !== null && matchedPrice.privyPriceListId !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_id_price_list_line',
        line,
        value: matchedPrice.privyPriceListId
      });
    }
    if (matchedPrice.publishedPrice !== null && matchedPrice.publishedPrice !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'rate', line, value: matchedPrice.publishedPrice });
      transactionRecord.setSublistValue({ 
        sublistId: ITEM_SUBLIST_ID, 
        fieldId: 'custcol_abj_total_published_price', 
        line, 
        value: Number(matchedPrice.publishedPrice) * Number(allocatedQuantity)
      });
    }
    if (matchedPrice.finalPrice !== null && matchedPrice.finalPrice !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_final_price',
        line,
        value: matchedPrice.finalPrice
      });
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_total_final_price',
        line,
        value: Number(matchedPrice.finalPrice) * Number(allocatedQuantity)
      });
    }
    // if (matchedPrice.billingType !== null && matchedPrice.billingType !== undefined) {
    //   transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'class', line, value: matchedPrice.billingType });
    // }
    if (matchedPrice.discountOrPremium !== null && matchedPrice.discountOrPremium !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_discount_premium',
        line,
        value: matchedPrice.discountOrPremium
      });
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_total_discount_premium',
        line,
        value: Number(matchedPrice.discountOrPremium) * Number(allocatedQuantity)
      });
    }
    
    if (matchedPrice.enterpriseSegment !== null && matchedPrice.enterpriseSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.enterpriseSegment,
        line,
        value: matchedPrice.enterpriseSegment
      });
    }
    if (matchedPrice.merchantSegment !== null && matchedPrice.merchantSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.merchantSegment,
        line,
        value: matchedPrice.merchantSegment
      });
    }
    if (matchedPrice.applicationSegment !== null && matchedPrice.applicationSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.applicationSegment,
        line,
        value: matchedPrice.applicationSegment
      });
    }
    if (matchedPrice.channelSegment !== null && matchedPrice.channelSegment !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: PRICE_LIST_FIELD_MAP.channelSegment,
        line,
        value: matchedPrice.channelSegment
      });
    }
    // if (matchedPrice.soId !== null && matchedPrice.soId !== undefined) {
    //   transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'custcol_abj_so_id', line, value: matchedPrice.soId });
    // }
    // if (matchedPrice.soLineId !== null && matchedPrice.soLineId !== undefined) {
    //   transactionRecord.setSublistValue({
    //     sublistId: ITEM_SUBLIST_ID,
    //     fieldId: 'custcol_abj_order_line',
    //     line,
    //     value: matchedPrice.soLineId
    //   });
    // }
  };


  const beforeSubmit = (context) => {
    log.debug({ title: 'abj_ue_usage beforeSubmit', details: context });
    try {
      const allowedEventTypes = [
        context.UserEventType.CREATE,
        context.UserEventType.EDIT,
        context.UserEventType.COPY
      ];

      if (!allowedEventTypes.includes(context.type)) {
        return;
      }

      const transactionRecord = context.newRecord;

      if (!transactionRecord) {
        return;
      }

      const customerId = transactionRecord.getValue({ fieldId: 'entity' });
      const hierarchyCustomerId = transactionRecord.getValue({ fieldId: 'custbody_abj_hierarchy_customer_' });
      const trandateValue = transactionRecord.getValue({ fieldId: 'trandate' });
      const formattedTranDate = formatDateForSuiteQL(trandateValue);
      const billingTypeOrClass = transactionRecord.getValue({ fieldId : 'class'});
      const customForm = transactionRecord.getValue({ fieldId : 'customform'});

      log.debug('data', {
        customerId, formattedTranDate,customForm
      })

      if(customForm != 187){ // payment gateway
         log.debug({
          title: 'Price list skipped',
          details: 'Not payment gateway'
        });
        return;
      }

      if (!customerId || !formattedTranDate) {
        log.debug({
          title: 'Price list skipped',
          details: 'Missing customer, hierarchy customer or transaction date'
        });
        return;
      }

      const lineCount = transactionRecord.getLineCount({ sublistId: ITEM_SUBLIST_ID });

      if (lineCount === 0) {
        return;
      }

      const itemData = [];
      for (let line = 0; line < lineCount; line += 1) {
        const itemId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'item', line });
        const customerHierarchyId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'custcol_abj_privy_customer_hierarchy_', line });
        const quantity = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'quantity', line });
        if (itemId) {
          itemData.push({
            itemId,
            customerHierarchyId,
            quantity
          });
        }
      }

      const priceLookupMap = buildPriceLookupMap(customerId, formattedTranDate, itemData);

      log.debug({ title: 'Price Lookup Map', details: priceLookupMap });

      const linePlans = [];

      for (let line = 0; line < itemData.length; line += 1) {
        const itmDt = itemData[line];
        const priceListEntries = priceLookupMap[`${itmDt.itemId}_${itmDt.customerHierarchyId}`];
        if (!priceListEntries || priceListEntries.length === 0) {
          continue;
        }
        let allocations;
        const matchedPrices = resolveMatchedPrices(priceListEntries, itmDt.quantity);
        if (!matchedPrices || matchedPrices.length === 0) {
          continue;
        }
        allocations = [{ matchedPrice: matchedPrices[0], quantity : itmDt.quantity }];
        linePlans.push({ line, allocations });
      }
      log.debug('line plans', linePlans);

      for (let i = linePlans.length - 1; i >= 0; i -= 1) {
        const { line, allocations } = linePlans[i];

        if (allocations.length === 1) {
          applyPriceListValuesToLine(transactionRecord, line, allocations[0].matchedPrice, allocations[0].quantity);
          continue;
        }

        // Needs splitting: snapshot the original line's other fields first.
        const snapshot = captureLineSnapshot(transactionRecord, ITEM_SUBLIST_ID, line);
        log.debug('snapshot', snapshot);

        // First allocation reuses the original line.
        applyPriceListValuesToLine(transactionRecord, line, allocations[0].matchedPrice, allocations[0].quantity);

        // Remaining allocations become new lines inserted right after.
        for (let allocationIndex = 1; allocationIndex < allocations.length; allocationIndex += 1) {
          const insertAt = line + allocationIndex;
          log.debug('insert at', insertAt);
          transactionRecord.insertLine({ sublistId: ITEM_SUBLIST_ID, line: insertAt });
          applyLineSnapshot(transactionRecord, ITEM_SUBLIST_ID, insertAt, snapshot);
          log.debug('applyLineSnapshot','applyLineSnapshot')
          applyPriceListValuesToLine(
            transactionRecord,
            insertAt,
            allocations[allocationIndex].matchedPrice,
            allocations[allocationIndex].quantity
          );
          log.debug('applyPriceListValuesToLine','applyPriceListValuesToLine')
        }
      }
      
    } catch (error) {
      log.error({ title: 'abj_ue_invoice_get_pricelist beforeSubmit error', details: error });
      throw error;
    }
  };

  const afterSubmit = (context) => {
    log.debug('AFTER SUBMIT', 'AFTER SUBMIT');
  };

  return {
    beforeSubmit,
    // afterSubmit
  };
});