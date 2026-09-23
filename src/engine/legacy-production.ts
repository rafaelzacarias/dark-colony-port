export interface LegacyProductionSourceRecord {
  readonly id: number;
  readonly cost: number;
  readonly interfaceId: number;
  readonly rawFields: readonly number[];
  readonly dependencies: readonly number[];
}

export interface LegacyProductionEntry extends LegacyProductionSourceRecord {
  readonly kind: "building" | "unit" | "upgrade" | "unknown";
  readonly unitType: number | null;
  readonly buildTimeTicks: null;
}

export interface LegacyProductionRequirements {
  readonly status: "satisfied" | "blocked" | "unknown";
  readonly missingDependencies: readonly number[];
  readonly creditShortfall: number | null;
}

export function createLegacyProductionCatalog(
  records: readonly LegacyProductionSourceRecord[],
): ReadonlyMap<number, LegacyProductionEntry> {
  const catalog = new Map<number, LegacyProductionEntry>();
  for (const record of records) {
    const values = [record.id, record.cost, record.interfaceId, ...record.dependencies];
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0)
      || record.rawFields.length === 0 || record.rawFields.some((value) => !Number.isSafeInteger(value))) {
      throw new RangeError(`invalid legacy production record ${record.id}`);
    }
    if (catalog.has(record.id)) throw new RangeError(`duplicate legacy production id ${record.id}`);
    const type = record.rawFields[0];
    const width = type === 1 ? 2 : type === 0 || type === 2 ? 4 : null;
    if (width !== null && record.rawFields.length !== width) {
      throw new RangeError(`legacy production ${record.id} requires ${width} raw fields; reparse DEPEND`);
    }
    catalog.set(record.id, Object.freeze({
      id: record.id,
      cost: record.cost,
      interfaceId: record.interfaceId,
      rawFields: Object.freeze([...record.rawFields]),
      dependencies: Object.freeze([...record.dependencies]),
      kind: type === 0 ? "building" : type === 1 ? "unit" : type === 2 ? "upgrade" : "unknown",
      unitType: type === 1 || type === 2 ? record.rawFields[1] : null,
      buildTimeTicks: null,
    }));
  }
  for (const entry of catalog.values()) {
    for (const dependency of entry.dependencies) {
      if (!catalog.has(dependency)) throw new RangeError(`legacy production ${entry.id} references missing ${dependency}`);
    }
  }
  return catalog;
}

export function checkLegacyProductionRequirements(
  catalog: ReadonlyMap<number, LegacyProductionEntry>,
  id: number,
  credits: number,
  satisfiedDependencyIds: ReadonlySet<number>,
): LegacyProductionRequirements {
  if (!Number.isSafeInteger(credits) || credits < 0) throw new RangeError("invalid production credits");
  const entry = catalog.get(id);
  if (!entry || entry.kind === "unknown") {
    return { status: "unknown", missingDependencies: [], creditShortfall: null };
  }
  const missingDependencies = entry.dependencies.filter((dependency) => !satisfiedDependencyIds.has(dependency));
  const creditShortfall = Math.max(0, entry.cost - credits);
  return {
    status: missingDependencies.length === 0 && creditShortfall === 0 ? "satisfied" : "blocked",
    missingDependencies,
    creditShortfall,
  };
}