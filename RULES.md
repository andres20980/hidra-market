# RULES.md v1.0 · Hidra Market — reglas exactas del mercado (contrato `contract/`)

Fuente: `hidra/consejo/DECISION.md` (10-nov-2026) y track `swarms` (`fuentes/prompts/tracks/05-swarms.md`).
Toda regla numerada aquí tiene al menos un test en `contract/` (unidad o integración con near-sandbox).

## 1. Cuentas y roles
- **Publicador (publisher):** crea la tarea con `post_task` y bloquea la recompensa en escrow.
- **Trabajador (worker):** cuenta (p. ej. `worker-N.<mercado>.testnet`) que se registra con `register_worker`.
- **Verificador (verifier):** única cuenta autorizada a llamar `attest` para una tarea dada; la fija el publicador en `post_task`. Es el «trinquete»: tests en verde.
- **Contrato:** ingresa todo el dinero; nadie recibe pagos salvo vía `close_round`/`refund_expired`.

## 2. Tarea y escrow (R1–R3)
- R1: `post_task` es `payable`: `attached_deposit` = recompensa máxima de la ronda y queda en escrow del contrato. Rechaza depósito 0.
- R2: Una tarea tiene: `id`, `publisher`, `verifier`, `reward` (escrow), `fee` (0 en v1), `state` (`Open`, `Closed`, `Settled`, `Refunded`), `round` (see §3).
- R3: El contrato guarda `spent_by_agent: map cuenta -> u128` (yoctoNEAR gastado como puja ganadora) y `cap_per_agent` (tope de gasto por agente, fijado en despliegue). Ninguna liquidación puede llevar a una cuenta por encima del tope: si el pago del ganador supera `cap - spent`, la ronda se cierra como `Refunded` (R8).

## 3. Ronda de subasta sellada inversa (R4–R9)
- R4: La ronda vive en **bloques**: `commit_end` y `reveal_end` son alturas de bloque absolutas fijadas en `post_task` (`commit_len`, `reveal_len` en bloques). Ventana de commit: `[open, commit_end)`; ventana de reveal: `[commit_end, reveal_end)`.
- R5: **Commit:** `commit_bid(commitment)` donde `commitment = sha256( price_be_u64 || salt_be_u32 || account_id_bytes )` (precio en yoctoNEAR, big-endian, sin separadores). Solo trabajadores registrados; un commit por trabajador por ronda; rechaza si no estamos en ventana de commit.
- R6: **Reveal:** `reveal_bid(price, salt)`; el contrato recalcula `sha256(...)` y exige igualdad con el commit guardado; borra el commit (reveal de una sola vez). Rechaza fuera de ventana de reveal o si no cuadra.
- R7: **Cierre (`close_round`)** tras `reveal_end`: gana la puja con menor **precio ajustado** `precio / media_beta`, donde `media_beta = α / (α + β)` de la reputación Beta(α, β) del trabajador (prior **(1,1)**, §5). Si `media_beta == 0` (α=0) no puja.
- R8: **Desempate (tie-break), en orden:** (1) menor precio nominal; (2) mayor reputación (α+β, luego α); (3) cuenta lexicográficamente menor. Determinista y público.
- R9: Si no hay reveals válidos, la ronda cierra sin ganador → `refund_expired` devuelve el escrow al publicador.

## 4. Entrega, atestación y pago (R10–R14)
- R10: Tras `close_round`, el ganador llama `submit_result(task_id, result_hash)` (hash del artefacto; p. ej. SHA-256 del bundle verificado).
- R11: Solo la cuenta `verifier` de la tarea puede llamar `attest(task_id, ok: bool)`.
- R12: `attest(ok=true)` → `state = Settled`: el contrato transfiere `reward` al ganador (menos fee si lo hubiera), suma a `spent_by_agent[ganador]`, y actualiza reputación: α += 1 (éxito). `attest(ok=false)` → reputación β += 1 y escrow vuelve al publicador (`Refunded`).
- R13: Doble pago prohibido: `attest` y `close_round` rechazan si `state != Closed` / `state != Settled` según corresponda; `submit_result` solo una vez por ganador.
- R14: `refund_expired`: a partir de `reveal_end + 100` bloques, si no hay `attest`, cualquiera puede llamar y el escrow vuelve al publicador; la reputación del ganador (si lo hubo y no entregó resultado) pierde: β += 1. Si la puja ganadora supera el tope de gasto restante del agente, `attest(ok=true)` devuelve el escrow al publicador sin pagar ni alterar reputación.

## 5. Reputación Beta (R15–R16)
- R15: `reputation[account] = (α, β)`, prior (1,1) en `register_worker`. Media = α/(α+β).
- R16: `get_reputation` devuelve (α, β, media) como strings JSON (u128 no entra en JSON nativo de near-sdk 5).

## 6. Vistas
`get_task(id)`, `list_tasks(from, limit)`, `get_round(task_id)`, `get_reputation(account)`, más `get_config` (cap por agente, verifier).

## 7. Diagrama de secuencia (una ronda)
```
publisher          contract                worker-1            worker-2         verifier
   |  post_task(reward, verifier, commit_len, reveal_len) |                   |                |
   |-------------->| escrow reward, state=Open, round=1      |                   |                |
   |               |   commit_bid(sha256(p||s||acct))        |                   |                |
   |               |<-------------|                          |                   |                |
   |               |   commit_bid(sha256(...))               |                   |                |
   |               |<-----------------------------------------|                   |                |
   |               |        [bloque >= commit_end]           |                   |                |
   |               |   reveal_bid(price, salt)               |                   |                |
   |               |<-------------|                          |                   |                |
   |               |   reveal_bid(price, salt)               |                   |                |
   |               |<-----------------------------------------|                   |                |
   |               |   close_round() -> ganador = min precio/mean_beta (R7,R8)     |                |
   |<--------------| state=Closed, winner=worker-1            |                   |                |
   |               |   submit_result(hash)                    |                   |                |
   |               |<-------------|                          |                   |                |
   |               |                    attest(task, true)   |                   |                |
   |               |------------------------------------------>|                   |                |
   |<--------------| paga reward a worker-1, α+=1, Settled  |                   |                |
   |               |   (attest false o timeout -> refund_expired: escrow a publisher, β+=1)
```
