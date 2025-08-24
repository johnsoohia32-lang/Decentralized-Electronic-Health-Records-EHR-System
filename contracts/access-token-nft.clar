;; AccessTokenNFT.clar
;; Manages NFT-based access tokens for granting/revoking permissions to patient EHRs
;; Tokens are minted by patients, assigned to doctors, and include granular permissions
;; Ensures secure, auditable, and time-bound access to health records

;; Constants
(define-constant ERR-NOT-PATIENT u200)
(define-constant ERR-NOT-TOKEN-OWNER u201)
(define-constant ERR-INVALID-PATIENT u202)
(define-constant ERR-INVALID-SCOPE u203)
(define-constant ERR-TOKEN-NOT-FOUND u204)
(define-constant ERR-TOKEN-EXPIRED u205)
(define-constant ERR-UNAUTHORIZED u206)
(define-constant ERR-INVALID-DURATION u207)
(define-constant ERR-INVALID-RECIPIENT u208)
(define-constant MAX-SCOPES u5)
(define-constant MAX-TERMS-LEN u200)
(define-constant MAX-METADATA-LEN u500)

;; Data Maps
(define-map access-tokens
  { token-id: uint }
  {
    patient-id: (buff 32),         ;; Patient's hashed ID from PatientRegistry
    owner: principal,              ;; Current token holder (doctor or patient)
    issued-to: principal,          ;; Doctor granted access
    scopes: (list 5 (string-ascii 20)),  ;; Permissions: e.g., "read-lab", "write-consult"
    expiry: uint,                  ;; Block height when token expires
    terms: (string-utf8 200),      ;; Additional terms or metadata
    issued-at: uint,               ;; Block height of issuance
    active: bool                   ;; Token status
  }
)

(define-map token-counter
  { patient-id: (buff 32) }
  { count: uint }
)

(define-map access-audit-log
  { token-id: uint, entry-id: uint }
  {
    action: (string-ascii 20),     ;; "minted", "transferred", "revoked", "accessed"
    by: principal,
    timestamp: uint,
    notes: (string-utf8 200)
  }
)

;; External contract dependency (assumed deployed)
(define-constant PATIENT-REGISTRY-CONTRACT .PatientRegistry)

;; Private Functions
(define-private (is-valid-patient (patient-id (buff 32)))
  (is-some (contract-call? PATIENT-REGISTRY-CONTRACT get-patient-profile patient-id))
)

(define-private (is-verified-patient (patient-id (buff 32)))
  (contract-call? PATIENT-REGISTRY-CONTRACT is-patient-verified patient-id)
)

(define-private (is-valid-scope (scope (string-ascii 20)))
  (or
    (is-eq scope "read-lab")
    (is-eq scope "read-consult")
    (is-eq scope "write-consult")
    (is-eq scope "read-imaging")
    (is-eq scope "emergency-access")
  )
)

(define-private (are-valid-scopes (scopes (list 5 (string-ascii 20))))
  (fold (lambda (scope acc) (and acc (is-valid-scope scope))) scopes true)
)

(define-private (is-token-owner (token-id uint) (caller principal))
  (match (map-get? access-tokens { token-id: token-id })
    token (is-eq (get owner token) caller)
    false
  )
)

(define-private (is-token-active (token-id uint))
  (match (map-get? access-tokens { token-id: token-id })
    token (and (get active token) (< block-height (get expiry token)))
    false
  )
)

;; Public Functions

;; Mint a new access token for a doctor
(define-public (mint-token
  (patient-id (buff 32))
  (recipient principal)
  (scopes (list 5 (string-ascii 20)))
  (duration uint)
  (terms (string-utf8 200)))
  (let (
    (patient-profile (contract-call? PATIENT-REGISTRY-CONTRACT get-patient-profile patient-id))
    (current-count (default-to u0 (get count (map-get? token-counter { patient-id: patient-id }))))
    (new-token-id (+ current-count u1))
  )
    (asserts! (is-some patient-profile) (err ERR-INVALID-PATIENT))
    (asserts! (is-eq (get owner (unwrap-panic patient-profile)) tx-sender) (err ERR-NOT-PATIENT))
    (asserts! (is-verified-patient patient-id) (err ERR-INVALID-PATIENT))
    (asserts! (are-valid-scopes scopes) (err ERR-INVALID-SCOPE))
    (asserts! (> duration u0) (err ERR-INVALID-DURATION))
    (asserts! (<= (len terms) MAX-TERMS-LEN) (err ERR-INVALID-DURATION))
    (asserts! (not (is-eq recipient tx-sender)) (err ERR-INVALID-RECIPIENT))
    (map-set access-tokens
      { token-id: new-token-id }
      {
        patient-id: patient-id,
        owner: recipient,
        issued-to: recipient,
        scopes: scopes,
        expiry: (+ block-height duration),
        terms: terms,
        issued-at: block-height,
        active: true
      }
    )
    (map-set token-counter
      { patient-id: patient-id }
      { count: new-token-id }
    )
    ;; Log minting
    (map-insert access-audit-log
      { token-id: new-token-id, entry-id: u0 }
      { action: "minted", by: tx-sender, timestamp: block-height, notes: terms }
    )
    (ok new-token-id)
  )
)

;; Revoke an access token (by patient or token owner)
(define-public (revoke-token (token-id uint))
  (let (
    (token (unwrap-panic (map-get? access-tokens { token-id: token-id })))
    (patient-profile (contract-call? PATIENT-REGISTRY-CONTRACT get-patient-profile (get patient-id token)))
  )
    (asserts! (is-some patient-profile) (err ERR-INVALID-PATIENT))
    (asserts! (or
      (is-eq (get owner (unwrap-panic patient-profile)) tx-sender)
      (is-token-owner token-id tx-sender))
      (err ERR-UNAUTHORIZED))
    (asserts! (is-token-active token-id) (err ERR-TOKEN-EXPIRED))
    (map-set access-tokens
      { token-id: token-id }
      (merge token { active: false })
    )
    ;; Log revocation
    (map-insert access-audit-log
      { token-id: token-id, entry-id: (+ (default-to u0 (get entry-id (map-get? access-audit-log { token-id: token-id, entry-id: u0 }))) u1) }
      { action: "revoked", by: tx-sender, timestamp: block-height, notes: "" }
    )
    (ok true)
  )
)

;; Transfer token to another doctor (by current token owner)
(define-public (transfer-token (token-id uint) (new-owner principal))
  (let (
    (token (unwrap-panic (map-get? access-tokens { token-id: token-id })))
  )
    (asserts! (is-token-owner token-id tx-sender) (err ERR-NOT-TOKEN-OWNER))
    (asserts! (is-token-active token-id) (err ERR-TOKEN-EXPIRED))
    (asserts! (not (is-eq new-owner (get owner (unwrap-panic (contract-call? PATIENT-REGISTRY-CONTRACT get-patient-profile (get patient-id token)))))) (err ERR-INVALID-RECIPIENT))
    (map-set access-tokens
      { token-id: token-id }
      (merge token { owner: new-owner, issued-to: new-owner })
    )
    ;; Log transfer
    (map-insert access-audit-log
      { token-id: token-id, entry-id: (+ (default-to u0 (get entry-id (map-get? access-audit-log { token-id: token-id, entry-id: u0 }))) u1) }
      { action: "transferred", by: tx-sender, timestamp: block-height, notes: (unwrap-panic (to-string new-owner)) }
    )
    (ok true)
  )
)

;; Log access attempt (called by EHRStorage when records are accessed)
(define-public (log-access (token-id uint) (notes (string-utf8 200)))
  (let (
    (token (unwrap-panic (map-get? access-tokens { token-id: token-id })))
  )
    (asserts! (is-token-owner token-id tx-sender) (err ERR-NOT-TOKEN-OWNER))
    (asserts! (is-token-active token-id) (err ERR-TOKEN-EXPIRED))
    (map-insert access-audit-log
      { token-id: token-id, entry-id: (+ (default-to u0 (get entry-id (map-get? access-audit-log { token-id: token-id, entry-id: u0 }))) u1) }
      { action: "accessed", by: tx-sender, timestamp: block-height, notes: notes }
    )
    (ok true)
  )
)

;; Read-only Functions

(define-read-only (get-token-details (token-id uint))
  (map-get? access-tokens { token-id: token-id })
)

(define-read-only (get-token-count (patient-id (buff 32)))
  (default-to u0 (get count (map-get? token-counter { patient-id: patient-id })))
)

(define-read-only (get-audit-log-entry (token-id uint) (entry-id uint))
  (map-get? access-audit-log { token-id: token-id, entry-id: entry-id })
)

(define-read-only (has-access (token-id uint) (caller principal))
  (match (map-get? access-tokens { token-id: token-id })
    token (and (is-eq (get owner token) caller) (is-token-active token-id))
    false
  )
)

(define-read-only (get-token-scopes (token-id uint))
  (match (map-get? access-tokens { token-id: token-id })
    token (ok (get scopes token))
    (err ERR-TOKEN-NOT-FOUND)
  )
)