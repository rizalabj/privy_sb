/**
 * @NApiVersion 2.1
 */
define(['N/query', 'N/log', 'N/error'], (query, log, error) => {
  const ITEM_SUBLIST_ID = 'item';
  const HIERARCHY_CUSTOMER_FIELD_ID = 'custbody_abj_hierarchy_customer_';
  const CUSTOMER_FIELD_ID = 'entity';

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

  const PREPAID_VALUE = 13;

  const priceListTypeMap = {
    26: 'normal',
    31: 'normalWithAchievement',
    32: 'normalTiering',
    33: 'accumulatedTiering',
    34: 'bundling'
  };

  // Fields we always set explicitly per allocation - never let the raw
  // snapshot copy clobber these after we've applied price-list-specific values.
  const PRICE_LIST_DRIVEN_FIELDS = [
    'quantity',
    'price',
    'rate',
    'custcol_abj_id_price_list_line',
    'custcol_abj_final_price',
    'class',
    'custcol_abj_discount_premium',
    'custcol_abj_one_time_discount',
    PRICE_LIST_FIELD_MAP.enterpriseSegment,
    PRICE_LIST_FIELD_MAP.merchantSegment,
    PRICE_LIST_FIELD_MAP.applicationSegment,
    PRICE_LIST_FIELD_MAP.channelSegment,
    'custcol_abj_so_id',
    'custcol_abj_order_line'
  ];

  const escapeSqlValue = (value) => String(value).replace(/'/g, "''");

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------

  const buildPriceLookupMap = (customerId, hierarchyCustomerId, trandate, itemIds) => {
    log.debug({
      title: 'buildPriceLookupMap',
      details: { customerId, hierarchyCustomerId, trandate, itemIds }
    });

    if (!customerId || !hierarchyCustomerId || !trandate || itemIds.length === 0) {
      return {};
    }

    const escapedHierarchyCustomerId = escapeSqlValue(hierarchyCustomerId);
    const escapedCustomerId = escapeSqlValue(customerId);
    const escapedDate = escapeSqlValue(trandate);
    const itemIdList = itemIds.map((itemId) => Number(itemId)).filter((itemId) => !Number.isNaN(itemId));

    if (itemIdList.length === 0) {
      return {};
    }

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
        BT.custrecord_abj_rev_rec_account AS billing_type_account,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.custcol_abj_dis_onetime_pcs ELSE NULL END AS so_one_time_discount_per_pcs,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.custcol_abj_qty_usage ELSE NULL END AS so_qty_usage,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.quantity ELSE NULL END AS so_qty,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.transaction ELSE NULL END AS so_id,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.so_trandate ELSE NULL END AS so_trandate,
        CASE WHEN pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13 THEN sol.id ELSE NULL END AS so_line_id
      FROM
        ${PRICE_LIST_RECORD_TYPE} pl
        JOIN classification BT ON BT.id = pl.${PRICE_LIST_FIELD_MAP.billingType}
        LEFT JOIN (
          SELECT
            tl.*,
            t.type AS so_type,
            t.trandate AS so_trandate
          FROM transactionline tl
          JOIN transaction t ON t.id = tl.transaction
          WHERE t.type = 'SalesOrd'
        ) sol
          ON sol.item = pl.${PRICE_LIST_FIELD_MAP.item}
          AND sol.custcol_abj_id_price_list_line = pl.id
          AND sol.custcol_abj_privy_customer_hierarchy_ = pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer}
          AND pl.${PRICE_LIST_FIELD_MAP.isPrepaidOrPostpaid} = 13
      WHERE
        pl.${PRICE_LIST_FIELD_MAP.hierarchyCustomer} = '${escapedHierarchyCustomerId}'
        AND pl.${PRICE_LIST_FIELD_MAP.customer} = '${escapedCustomerId}'
        AND pl.isinactive = 'F'
        AND TO_DATE('${escapedDate}', 'YYYY-MM-DD')
          BETWEEN pl.${PRICE_LIST_FIELD_MAP.startDate}
          AND pl.${PRICE_LIST_FIELD_MAP.endDate}
        AND pl.${PRICE_LIST_FIELD_MAP.item} IN (${itemIdList.join(', ')})
      ORDER BY
        sol.so_trandate ASC NULLS LAST,
        sol.transaction ASC NULLS LAST
    `;

    log.debug({ title: 'Price List Query', details: suiteQL });

    const resultSet = query.runSuiteQL({ query: suiteQL });
    const mappedResults = resultSet.asMappedResults();

    log.debug('mappedResults', mappedResults);

    // Group by item, then de-duplicate by price-list-bucket id: the LEFT JOIN
    // to historical SO lines can return several rows for the same bucket
    // (one per matching historical SO line). We only want ONE entry per
    // bucket, holding the MOST RECENT custcol_abj_qty_usage value (since the
    // query is already ordered by so_trandate ASC, the last time we see a
    // given bucket id is the most up-to-date usage figure). Using a Map
    // preserves the FIFO order (oldest/most-used bucket first) established by
    // the ORDER BY, since Map.set() on an existing key keeps its original
    // position and only refreshes the value.
    const bucketMapsByItem = {};

    
    mappedResults.forEach((result) => {
      const itemId = String(result.item_id);
      
      // FIX: Gunakan ID Baris SO (so_line_id) sebagai pemisah bucket jika ada.
      // Jika bukan prepaid (tidak ada so_line_id), kembali gunakan ID Price List.
      // Menggabungkan SO ID dan SO Line ID agar benar-benar unik secara global
      const bucketId = (result.so_id && result.so_line_id) 
          ? 'SO_' + result.so_id + '_LINE_' + result.so_line_id 
          : 'PL_' + result.privyPriceListId;

      if (!bucketMapsByItem[itemId]) {
        bucketMapsByItem[itemId] = new Map();
      }

      bucketMapsByItem[itemId].set(bucketId, mapPriceListRow(result));
    });

    const priceLookupMap = {};
    Object.keys(bucketMapsByItem).forEach((itemId) => {
      priceLookupMap[itemId] = Array.from(bucketMapsByItem[itemId].values());
    });

    return priceLookupMap;
  };

  // ---------------------------------------------------------------------
  // Pricing resolution: normal / min-achievement / tiering / accumulated
  // ---------------------------------------------------------------------

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
  // Prepaid FIFO bucket allocation
  // ---------------------------------------------------------------------

  /**
   * Consumes prepaid buckets FIFO (in the order they're given, which already
   * reflects the SQL's "already-used buckets first, unused buckets last"
   * ordering) until `quantity` is fully allocated, or buckets run out.
   *
   * Remaining capacity per bucket = soQty - soQtyUsage.
   */
  const resolvePrepaidAllocations = (prepaidBuckets, quantity) => {
    let remainingToAllocate = quantity;
    const allocations = [];

    for (const bucket of prepaidBuckets) {
      if (remainingToAllocate <= 0) {
        break;
      }

      if (bucket.soQty === null) {
        continue; // bucket has no defined capacity, can't be used for prepaid allocation
      }

      const bucketUsed = bucket.soQtyUsage || 0;
      const bucketRemaining = Math.max(0, bucket.soQty - bucketUsed);

      if (bucketRemaining <= 0) {
        continue; // bucket exhausted
      }

      const qtyFromBucket = Math.min(bucketRemaining, remainingToAllocate);
      allocations.push({ matchedPrice: bucket, quantity: qtyFromBucket });
      remainingToAllocate -= qtyFromBucket;
    }

    return { allocations, shortfall: remainingToAllocate };
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
    }
    if (matchedPrice.finalPrice !== null && matchedPrice.finalPrice !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_final_price',
        line,
        value: matchedPrice.finalPrice
      });
    }
    if (matchedPrice.billingType !== null && matchedPrice.billingType !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'class', line, value: matchedPrice.billingType });
    }
    if (matchedPrice.discountOrPremium !== null && matchedPrice.discountOrPremium !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_discount_premium',
        line,
        value: matchedPrice.discountOrPremium
      });
    }
    if (matchedPrice.soOneTimeDiscountPerPcs) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_one_time_discount',
        line,
        value: Math.abs(Number(matchedPrice.soOneTimeDiscountPerPcs)) * Number(allocatedQuantity)
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
    if (matchedPrice.soId !== null && matchedPrice.soId !== undefined) {
      transactionRecord.setSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'custcol_abj_so_id', line, value: matchedPrice.soId });
    }
    if (matchedPrice.soLineId !== null && matchedPrice.soLineId !== undefined) {
      transactionRecord.setSublistValue({
        sublistId: ITEM_SUBLIST_ID,
        fieldId: 'custcol_abj_order_line',
        line,
        value: matchedPrice.soLineId
      });
    }
  };

  // ---------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------

  const applyPriceListToTransaction = ({ transactionRecord }) => {
    try {
      log.debug({ title: 'applyPriceListToTransaction', details: transactionRecord });

      if (!transactionRecord) {
        return;
      }

      const customerId = transactionRecord.getValue({ fieldId: CUSTOMER_FIELD_ID });
      const hierarchyCustomerId = transactionRecord.getValue({ fieldId: HIERARCHY_CUSTOMER_FIELD_ID });
      const trandateValue = transactionRecord.getValue({ fieldId: 'trandate' });
      const formattedTranDate = formatDateForSuiteQL(trandateValue);

      if (!customerId || !hierarchyCustomerId || !formattedTranDate) {
        log.debug({
          title: 'Price list skipped',
          details: 'Missing customer, hierarchy customer, or transaction date'
        });
        return;
      }

      const lineCount = transactionRecord.getLineCount({ sublistId: ITEM_SUBLIST_ID });

      if (lineCount === 0) {
        return;
      }

      const itemIds = [];
      for (let line = 0; line < lineCount; line += 1) {
        const itemId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'item', line });
        if (itemId) {
          itemIds.push(itemId);
        }
      }

      const uniqueItemIds = [...new Set(itemIds.map((itemId) => String(itemId)))];
      const priceLookupMap = buildPriceLookupMap(customerId, hierarchyCustomerId, formattedTranDate, uniqueItemIds);

      log.debug({ title: 'Price Lookup Map', details: priceLookupMap });

      if (!priceLookupMap || Object.keys(priceLookupMap).length === 0) {
        return;
      }

      // Every matched price list entry must share the same revenue account /
      // billing type, otherwise the transaction can't be saved as-is.
      let billingTypeAccount = null;
      let billingType = null;

      Object.keys(priceLookupMap).forEach((itemKey) => {
        priceLookupMap[itemKey].forEach((price) => {
          if (billingTypeAccount && billingTypeAccount !== price.billingTypeAccount) {
            throw error.create({
              name: 'PRICE_LIST_ACCOUNT_MISMATCH',
              message:
                'Transaksi gagal: Item yang dipilih memiliki tujuan Akun yang berbeda. Silakan pisahkan ke dalam transaksi terpisah.',
              notifyOff: true
            });
          }
          billingTypeAccount = price.billingTypeAccount;
          billingType = price.billingType;
        });
      });

      transactionRecord.setValue({ fieldId: 'account', value: billingTypeAccount });
      transactionRecord.setValue({ fieldId: 'class', value: billingType });

      // ---- Pass 1: figure out what each line needs (no mutation yet) ----
      const linePlans = [];

      for (let line = 0; line < lineCount; line += 1) {
        const itemId = transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'item', line });
        const quantity = Number(transactionRecord.getSublistValue({ sublistId: ITEM_SUBLIST_ID, fieldId: 'quantity', line })) || 0;

        if (!itemId) {
          continue;
        }

        const priceListEntries = priceLookupMap[String(itemId)];
        if (!priceListEntries || priceListEntries.length === 0) {
          continue;
        }

        const prepaidEntries = priceListEntries.filter((entry) => entry.isPrepaidOrPostpaid === 'prepaid');
        log.debug('prepaidEntries', prepaidEntries);
        let allocations;

        if (prepaidEntries.length > 0) {
          const { allocations: prepaidAllocations, shortfall } = resolvePrepaidAllocations(prepaidEntries, quantity);

          if (shortfall > 0) {
            // ASSUMPTION: if the combined remaining quota across all prepaid
            // buckets can't cover the requested quantity, we block the save.
            // Let me know if you'd rather fall back to postpaid/normal price
            // for the uncovered remainder instead.
            throw error.create({
              name: 'PRICE_LIST_PREPAID_QUOTA_INSUFFICIENT',
              message: `Transaksi gagal: Kuota prepaid untuk item pada baris ${line + 1} tidak mencukup. Kekurangan: ${shortfall}.`,
              notifyOff: true
            });
          }

          allocations = prepaidAllocations;
        } else {
          const matchedPrices = resolveMatchedPrices(priceListEntries, quantity);
          if (!matchedPrices || matchedPrices.length === 0) {
            continue;
          }
          allocations = [{ matchedPrice: matchedPrices[0], quantity }];
        }

        linePlans.push({ line, allocations });
      }

      log.debug('line plans', linePlans);

      // ---- Pass 2: apply plans back-to-front so inserted lines never shift
      //      the index of a line we still need to process ----
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
      
    } catch (err) {
      log.error('error applyPriceListToTransaction', err);

      // Business-rule validation errors must stop the save; only swallow
      // unexpected/runtime errors so the transaction can still save gracefully.
      if (err && (err.name === 'PRICE_LIST_ACCOUNT_MISMATCH' || err.name === 'PRICE_LIST_PREPAID_QUOTA_INSUFFICIENT')) {
        throw err;
      }
    }
  };

  return {
    applyPriceListToTransaction
  };
});