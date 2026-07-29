// Rust port of src/data/fieldTypes.js + src/data/entryTemplates.js.
// Static reference data consumed by field.rs and entry.rs.

pub const FIELD_TYPES: &[&str] = &["text", "password", "email", "url", "note", "number", "date", "pin"];
pub const AUTO_HIDDEN_TYPES: &[&str] = &["password", "pin"];

pub struct TemplateField {
    pub label: &'static str,
    pub field_type: &'static str,
}

pub struct EntryTemplate {
    pub name: &'static str,
    pub icon: &'static str,
    pub fields: &'static [TemplateField],
}

macro_rules! tf {
    ($label:expr, $type:expr) => {
        TemplateField { label: $label, field_type: $type }
    };
}

pub const ENTRY_TEMPLATES: &[EntryTemplate] = &[
    EntryTemplate {
        name: "Login",
        icon: "key",
        fields: &[tf!("Username", "text"), tf!("Password", "password"), tf!("Website", "url")],
    },
    EntryTemplate {
        name: "Secure Note",
        icon: "note",
        fields: &[tf!("Note", "note")],
    },
    EntryTemplate {
        name: "Credit Card",
        icon: "credit-card",
        fields: &[
            tf!("Cardholder Name", "text"),
            tf!("Card Number", "password"),
            tf!("Expiry Date", "text"),
            tf!("CVV", "pin"),
            tf!("PIN", "pin"),
        ],
    },
    EntryTemplate {
        name: "Bank Account",
        icon: "bank",
        fields: &[
            tf!("Bank Name", "text"),
            tf!("Account Number", "password"),
            tf!("Routing Number", "text"),
            tf!("IBAN", "text"),
        ],
    },
    EntryTemplate {
        name: "License Key",
        icon: "tag",
        fields: &[tf!("Product", "text"), tf!("License Key", "password")],
    },
    EntryTemplate {
        name: "API Key",
        icon: "code",
        fields: &[tf!("Service", "text"), tf!("API Key", "password"), tf!("API Secret", "password")],
    },
    EntryTemplate {
        name: "SSH Key",
        icon: "terminal",
        fields: &[
            tf!("Host", "text"),
            tf!("Username", "text"),
            tf!("Private Key", "note"),
            tf!("Passphrase", "password"),
        ],
    },
    EntryTemplate {
        name: "WiFi",
        icon: "wifi",
        fields: &[tf!("Network Name (SSID)", "text"), tf!("Password", "password")],
    },
    EntryTemplate {
        name: "Custom",
        icon: "file",
        fields: &[tf!("Text", "text"), tf!("Password", "password")],
    },
];

pub fn template_by_name(name: &str) -> Option<&'static EntryTemplate> {
    ENTRY_TEMPLATES.iter().find(|t| t.name == name)
}
