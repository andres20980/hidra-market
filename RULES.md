# RULES.md v1.3 · Hidra Market — reglas del contrato

Especificación de la implementación en `contract/`. Los plazos se expresan en alturas de bloque NEAR.

## 1. Roles y creación de tareas

- El publicador llama `post_task(id, verifier, commit_len, reveal_len)` con un depósito adjunto mayor que cero; el depósito completo es la recompensa en escrow.
- El identificador de tarea debe ser único. El contrato fija `commit_end = altura_actual + commit_len` y `reveal_end = commit_end + reveal_len`; los cálculos que desbordan se rechazan.
- El publicador declara el verificador de esa tarea. No hay depósito para registrarse, comprometer ni revelar pujas.
- Un trabajador llama `register_worker`; su reputación inicial es Beta(1,1), es decir, `alpha=1`, `beta=1`.

## 2. Compromiso y revelación

- Solo trabajadores registrados pueden llamar `commit_bid`. Se admite un compromiso por trabajador y tarea, de exactamente 32 bytes (SHA-256), mientras `altura < commit_end`.
- El precio de la puja es un `u64` en miliNEAR (80 = 0,08 NEAR): es la oferta del trabajador; el pago liberado es siempre la recompensa en escrow.
- El compromiso se calcula como `SHA-256(precio_u64_be || sal_u32_be || cuenta_utf8)`: precio `u64` y sal `u32` en big-endian, seguidos de los bytes UTF-8 del identificador de cuenta, sin separadores.
- `reveal_bid(precio, sal)` solo se acepta en `[commit_end, reveal_end)`. Debe hacerlo la cuenta del compromiso y el hash recalculado debe coincidir; en caso contrario se rechaza. Cada compromiso válido se revela una sola vez.
- Una duración cero es válida: `commit_len=0` impide comprometer y `reveal_len=0` impide revelar.

## 3. Cierre y selección del ganador

- Cualquier cuenta puede llamar `close_round` desde `reveal_end`, inclusive. Se ignoran compromisos no revelados.
- Para reputación Beta(`alpha`, `beta`), la media es `alpha/(alpha+beta)` y el precio ajustado es `precio / media`. Si `alpha=0`, la puja no es elegible. Una reputación no inicializada usa el prior (1,1).
- La comparación del precio ajustado se hace como fracción exacta `precio*(alpha+beta)/alpha`, sin redondeo.
- Gana el menor precio ajustado. En igualdad exacta, desempata, en este orden: menor precio nominal; mayor `alpha+beta`; mayor `alpha`; y cuenta con orden lexicográfico menor.
- Si no hay pujas reveladas elegibles, la ronda se cierra sin ganador.

## 4. Resultado, atestación, pago y reembolso

- Solo el ganador de una ronda cerrada puede llamar `submit_result` y registrar un hash de resultado; solo se admite una entrega.
- Solo el verificador declarado en `post_task` puede llamar `attest`, y solo después de recibir el resultado. La primera atestación termina la tarea.
- Con `attest(ok=true)`, se paga la recompensa íntegra al ganador, se suma a su gasto acumulado y `alpha` aumenta en uno. El gasto solo cuenta recompensas efectivamente pagadas y se acumula entre tareas.
- El tope de gasto por agente (`cap_per_agent`) se fija al inicializar el contrato. Si el pago excede el tope restante, la tarea se marca reembolsada y se devuelve el depósito al publicador; no se paga ni se modifica gasto o reputación.
- Con `attest(ok=false)`, se devuelve la recompensa al publicador y `beta` del ganador aumenta en uno.
- Desde `reveal_end + 100` bloques, inclusive, cualquier cuenta puede llamar `refund_expired` si la tarea sigue cerrada. Devuelve el depósito al publicador. Si no se presentó resultado y había ganador, se suma uno a su `beta`; si sí se presentó, no hay penalización. Una ronda cerrada sin ganador también se puede reembolsar.

## 5. Vistas

`get_task(id)`, `list_tasks(from, limit)`, `get_round(task_id)` y `get_reputation(account)` exponen tareas, rondas y reputación; `get_reputation` devuelve `alpha`, `beta` y media como cadenas JSON.

## 6. Secuencia textual de una ronda

1. Publicador → `post_task` con depósito, verificador y ventanas.
2. Trabajadores → `register_worker` y `commit_bid(SHA-256(precio||sal||cuenta))` antes de `commit_end`.
3. Trabajadores → `reveal_bid(precio, sal)` desde `commit_end` y antes de `reveal_end`.
4. Cualquier cuenta → `close_round` desde `reveal_end`; el contrato selecciona al ganador.
5. Ganador → `submit_result(hash)`; verificador → `attest(ok)`.
6. Si `ok=true` y el tope lo permite, cobra el ganador y aumenta `alpha`; si `ok=false`, se reembolsa al publicador y aumenta `beta`. Si vence el plazo sin atestación, cualquier cuenta activa el reembolso.
