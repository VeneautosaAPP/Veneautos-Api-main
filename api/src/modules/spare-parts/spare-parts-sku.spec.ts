import { computeNextSku, normalizeSparePartSku } from './spare-parts.service';

describe('normalizeSparePartSku', () => {
  it('mayúsculas y elimina los no alfanuméricos', () => {
    expect(normalizeSparePartSku('  aceite-15w40 ')).toBe('ACEITE15W40');
  });

  it('resuelve a vacío si no quedan caracteres', () => {
    expect(normalizeSparePartSku('   -_ ')).toBe('');
  });
});

describe('computeNextSku', () => {
  it('catálogo vacío -> R0001', () => {
    expect(computeNextSku([])).toBe('R0001');
  });

  it('consecutivo simple', () => {
    expect(computeNextSku(['R0001', 'ABC123', 'R0002'])).toBe('R0003');
  });

  it('ignora SKUs no autogenerados', () => {
    expect(computeNextSku(['ACEITE15W40', 'FILTRO-01'])).toBe('R0001');
  });

  it('salta de R9999 a R10000 (sin truncar dígitos)', () => {
    expect(computeNextSku(['R9999'])).toBe('R10000');
  });

  it('ignora SKUs que no coinciden con el patrón R mayúscula', () => {
    expect(computeNextSku(['r0007', 'R0002', 'ACEITE15W40'])).toBe('R0003');
  });
});