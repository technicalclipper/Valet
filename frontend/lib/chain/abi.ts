// Generated from contracts/out/Valet.sol/Valet.json — do not edit by hand.
// Regenerate with `npm run abi` after changing the contract, so the frontend
// cannot drift from what is deployed.

export const valetAbi = [
  {
    "type": "function",
    "name": "ESCALATION_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedTarget",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approveEscalation",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "beneficiaryOf",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "holder",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "escalationDigest",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "escalationNonce",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct SpendRequest",
        "components": [
          {
            "name": "capsuleId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quotedOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "venueData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeElevated",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct SpendRequest",
        "components": [
          {
            "name": "capsuleId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quotedOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "venueData",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fundVault",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getCapsule",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Capsule",
        "components": [
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "principal",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "holder",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mode",
            "type": "uint8",
            "internalType": "enum BeneficiaryMode"
          },
          {
            "name": "fixedBeneficiary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "policyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bounds",
            "type": "tuple",
            "internalType": "struct Bounds",
            "components": [
              {
                "name": "perAction",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "perWindow",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "hardCap",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "totalCap",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "windows",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "windowLength",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "notBefore",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiresAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "maxSlippageBps",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          },
          {
            "name": "spentTotal",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "spentInWindow",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lastWindowIndex",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "surrendered",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "pausedByIssuer",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "pausedByPrincipal",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getEscalation",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Escalation",
        "components": [
          {
            "name": "requestedAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "approvedAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "requested",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "approved",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "consumed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getVault",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Vault",
        "components": [
          {
            "name": "asset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "balance",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "revoked",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "headroom",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "perActionLeft",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "windowLeft",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "totalLeft",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "windowIndex",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mintCapsule",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct MintParams",
        "components": [
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "principal",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "mode",
            "type": "uint8",
            "internalType": "enum BeneficiaryMode"
          },
          {
            "name": "fixedBeneficiary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assetOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "policyHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "bounds",
            "type": "tuple",
            "internalType": "struct Bounds",
            "components": [
              {
                "name": "perAction",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "perWindow",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "hardCap",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "totalCap",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "windows",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "windowLength",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "notBefore",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "expiresAt",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "maxSlippageBps",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          },
          {
            "name": "allowedTargets",
            "type": "address[]",
            "internalType": "address[]"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nextCapsuleId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextVaultId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openVault",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "preflight",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct SpendRequest",
        "components": [
          {
            "name": "capsuleId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quotedOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "which",
        "type": "uint8",
        "internalType": "enum Assert"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "preflightElevated",
    "inputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct SpendRequest",
        "components": [
          {
            "name": "capsuleId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "vaultId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "quotedOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "target",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "which",
        "type": "uint8",
        "internalType": "enum Assert"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proceedsOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requestEscalation",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "nonce",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revoke",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeVault",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeVaultAndSweep",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPausedByIssuer",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPausedByPrincipal",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "paused",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "surrender",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "sweepProceeds",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tighten",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "b",
        "type": "tuple",
        "internalType": "struct Bounds",
        "components": [
          {
            "name": "perAction",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "perWindow",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "hardCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalCap",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "windows",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "windowLength",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "notBefore",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "CapsuleClaimed",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsuleMinted",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "vaultId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "principal",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "policyHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "mode",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BeneficiaryMode"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsulePaused",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "isIssuer",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "paused",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsuleRevoked",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsuleSurrendered",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "principal",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CapsuleTightened",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscalationApproved",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscalationConsumed",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amountUsed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscalationRequested",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "reason",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Executed",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "holder",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "target",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ProceedsSwept",
    "inputs": [
      {
        "name": "capsuleId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultFunded",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "balance",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultOpened",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultRevoked",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VaultSwept",
    "inputs": [
      {
        "name": "vaultId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyApproved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AlreadyConsumed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadBounds",
    "inputs": [
      {
        "name": "what",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "BadSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BelowFloor",
    "inputs": [
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoSuchCapsule",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoSuchVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotATightening",
    "inputs": [
      {
        "name": "what",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotApproved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotIssuer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPrincipal",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotRequested",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToSweep",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OverApprovedAmount",
    "inputs": [
      {
        "name": "asked",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "approved",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "PastDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PayoutFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PointlessEscalation",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Refused",
    "inputs": [
      {
        "name": "which",
        "type": "uint8",
        "internalType": "enum Assert"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "VaultIsRevoked",
    "inputs": []
  },
  {
    "type": "error",
    "name": "VenueCallFailed",
    "inputs": [
      {
        "name": "reason",
        "type": "bytes",
        "internalType": "bytes"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongAsset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
