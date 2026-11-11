#!/usr/bin/env python3
# derive_rates.py v1.0 - tasas LOCKED reales por worker desde data/hidra_week.jsonl
import json
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data', 'hidra_week.jsonl')
RATES = os.path.join(HERE, '..', 'worker_rates.json')
TOP20 = os.path.join(HERE, '..', 'workers_top20.json')

def main():
    total = Counter()
    locked = Counter()
    with open(DATA) as f:
        for line in f:
            d = json.loads(line)
            w = d['worker']
            total[w] += 1
            if d['resultado'] == 'LOCKED':
                locked[w] += 1
    rates = {w: (locked[w] / total[w]) if total[w] else 0.0 for w in total}
    # top 20 por volumen de tareas real (desempate: tasa, luego id)
    top20 = sorted(total, key=lambda w: (-total[w], -rates[w], w))[:20]
    with open(RATES, 'w') as f:
        json.dump({'source': 'hidra_week.jsonl (%d filas, %d workers)' % (sum(total.values()), len(total)),
                   'tasa_locked': dict(sorted(rates.items()))}, f, indent=2)
    with open(TOP20, 'w') as f:
        json.dump([[w, total[w]] for w in top20], f, indent=2)
    print('workers=%d top20=%s' % (len(total), top20[:3]))

if __name__ == '__main__':
    main()
