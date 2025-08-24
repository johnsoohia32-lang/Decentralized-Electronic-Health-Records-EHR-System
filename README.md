# 🏥 Decentralized Electronic Health Records (EHR) System

Welcome to a revolutionary decentralized EHR system built on the Stacks blockchain! This project empowers patients in underserved regions to securely store and control access to their health records using tokenized permissions. By leveraging blockchain technology, it reduces data breaches, ensures privacy, and enables seamless global access for authorized doctors—addressing critical issues like fragmented healthcare data and lack of patient control in areas with limited infrastructure.

## ✨ Features

🔒 Patient-owned data with encrypted storage on-chain  
🛡️ Tokenized access permissions (NFT-based) for granular control  
🌍 Worldwide doctor access without centralized intermediaries  
📋 Immutable audit trails for all data interactions  
🚨 Real-time notifications for access requests and grants  
📉 Reduced data breaches through zero-knowledge proofs for verification  
💡 Interoperability with existing health systems via APIs  
✅ Compliance with privacy standards like HIPAA-inspired rules  
🌐 Focus on underserved regions with low-cost transactions  

## 🛠 How It Works

**For Patients**  
- Register your profile and upload encrypted health records (e.g., medical history, lab results) via the patient dashboard.  
- Generate access tokens (NFTs) specifying permissions (e.g., read-only for consultations, time-limited).  
- Grant tokens to verified doctors worldwide—revoke anytime for full control.  
- Receive notifications for access requests and view audit logs to monitor who viewed what.  

Boom! Your health data is private, portable, and under your command—no more silos or unauthorized leaks.

**For Doctors**  
- Register and verify your credentials on-chain.  
- Request access tokens from patients for specific records.  
- Use granted tokens to decrypt and view records securely.  
- Log consultations immutably for accountability.  

That's it! Instant, borderless collaboration while respecting patient privacy.

## 📜 Smart Contracts

This system involves 8 smart contracts written in Clarity, ensuring modularity, security, and scalability. Here's a breakdown:

1. **PatientRegistry.clar**  
   Handles patient registration, storing hashed identities and basic metadata. Ensures unique profiles and basic KYC-like verification.

2. **DoctorRegistry.clar**  
   Manages doctor registrations, including credential verification (e.g., linking to off-chain proofs). Maintains a directory of verified professionals.

3. **EHRStorage.clar**  
   Securely stores encrypted health records as maps or lists, associated with patient principals. Uses Clarity's data structures for efficient retrieval.

4. **AccessTokenNFT.clar**  
   Implements NFT standards for access tokens. Each token represents permission scopes (e.g., read/write, expiration). Patients mint and transfer these to doctors.

5. **PermissionManager.clar**  
   Core logic for granting, revoking, and checking permissions. Integrates with AccessTokenNFT to enforce rules via traits and functions.

6. **AuditLog.clar**  
   Records all interactions (e.g., access grants, views, revokes) in an immutable log. Supports queries for transparency and compliance.

7. **NotificationSystem.clar**  
   Triggers on-chain events for notifications (e.g., access requests). Can integrate with off-chain push services for real-time alerts.

8. **VerificationHelper.clar**  
   Provides utility functions for zero-knowledge proofs and encryption key management, ensuring privacy during verifications without revealing full data.