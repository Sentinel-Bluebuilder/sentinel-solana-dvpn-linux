# Language rules

Written before any sentence is translated. Every language: `reviewed: no` (no native speaker
has read it). Terms are in `TERMS.md` and `terms/<code>.md`.

## All languages

- Placeholders such as `{place}` and `{amount}` stay exactly as written, never translated,
  never reordered inside the braces. A sentence may move a placeholder to where the grammar
  needs it.
- Never translated: Devnet dVPN, Devnet, Sentinel, Solana, tDVPN, SOL, protocol names, DNS, CSV,
  GB, addresses, commands, error codes. They stay in Latin letters in every script.
- Amounts and units: the number comes from the system formatter for the language; the unit
  (`tDVPN`, `SOL`, `GB`) follows the number with a space, in Latin letters.
- Money and safety sentences (paying, refunds, the recovery phrase, the kill switch) state facts
  plainly, with no softening and no added promise. They are checked twice.
- "Nothing was paid" is a plain statement of fact, not an apology.
- Tone: short, calm, direct, the way the system's own settings pages speak.
- **Page names.** The app's page names (Connect, Servers, Plans, Wallet, Activity, Kill switch,
  Split tunnelling, Diagnostics, Settings, Terminal, Node test) must read as names, apart from
  the everyday verb or noun. The same word appears in the navigation and in every sentence that
  sends the user there ("Open Diagnostics"). If the natural word is also a common word (a verb
  such as "connect", or the everyday word for "check"), add the language's word for page or
  screen in those sentences, or put the name in the language's quotation marks. Each sheet lists
  the names as terms of kind `name`. The pre-check matches the English name case-sensitively and
  requires the exact page name in the translation.
- **Required readings.** These keys were read back wrong in at least one language. Every
  language must carry the reading given here. A new finding of this kind is added to this list
  and checked in every finished locale.
  - "On and watching" (kill switch status): the kill switch is armed and checking the
    connection. Never a word for surveillance or being watched.
  - "Deposit": a refundable security deposit held for one server. Never a bank deposit, a
    savings deposit or a gift.
  - "Kill switch" sentences: the internet or the traffic is blocked or cut, never the app.
  - "Refund" buttons, titles and confirm lines ("Refund now", "Refund all now?", "Refund that
    device's deposits", "…then refund its deposits here"): the money comes to the user, into
    their wallet. Use the form for getting or taking a refund ("get your refund", "take back
    into your wallet"), never a bare verb that reads as the user paying someone back or
    giving the deposit back. Found in ur, fr, fa and bn, and checked in every finished locale. The
    refund word must also differ from the word for "Back" (going back a page).
  - "Claim refunds" (moves finished refunds into the wallet balance) and "Refund now" / "Refund
    all now" (starts a refund early) are different actions and must not read the same. Where
    the "get the refund" form makes them collide, give Claim its own verb (claim, collect) or
    write Refund now as "start the refund now".
  - Example amounts the user is meant to type or copy ("Use a number like 0.05", "like 2.5"):
    written exactly as the amount parser takes them, ASCII digits with a dot as the decimal mark
    (0.05), in every language, including those with their own digits or a decimal comma (fr, fa,
    ar, ur, ps, ckb, bn, hi, th, my…). Amounts that are only shown keep the language's own
    formatting through the formatter. Found in fr and fa; holds until the parser accepts local
    digits and a decimal comma.
  - "Asset": the token. Never "active" or a status word.
  - "Renews by {date}" / "renews until": it renews automatically until that date. Not an
    instruction to the user.
  - "This transaction was already processed": neutral, not a success message.
  - "Plus … tDVPN of refunds ready to add in Wallet": refunds the user can add on the Wallet
    page. Not a separate "refund wallet".
  - "Insert" (a button): put in, enter. Not the word that also means a listing.
  - "Within {SWEEP_MIN} min": at most that long, not exactly that long.
  - "Have some sent to your address" / "Have {what} sent to it": someone else (another
    person or the faucet) sends tokens, and the user's own wallet address receives them. The
    user asks for them; the user does not send anything, and never to "your own address".
  - "Per-GB and per-hour prices are never compared": a statement that the app does not
    compare the two kinds of price. Not an order to the user ("never compare").
  - "Not offered" (a server's price type): the server does not sell this kind of price. Not
    "unavailable" or "offline".
  - "Block connections without VPN": the name of the phone system's switch, written as a
    switch name. Not a status ("connections are blocked").
  - "Light" (theme) and "On" (a switch) must be different words where the language uses one
    word for both.
  - "Off" (a switch or the service) and "blocked" (internet or traffic) must be different words.
    Where the everyday word for "off" also means closed or blocked, use another word for the
    switch state, so "Off: no block" never reads as "Blocked: no block".
  - "Most on deposit at once": an amount of tDVPN held in deposits at the same time, not a
    number of deposits.
  - The "first block" of a session's cost is a paid portion of time or data (a part, a period).
    Never use the word for blocked internet or the kill switch for it.
  - "This server does not offer this pricing": the option is not available on that server.
    Never "does not pay" or "does not give".
- **No colliding short words.** A short loan or transliterated word that is also a grammatical
  word in the language is never used (Hindi "की" for "key" is also the genitive "of"). Take the
  unambiguous form from the sheet.

## zh-Hans — Chinese (Simplified)

- **Address**: 你. The computer system's help pages use 你; the phone system uses 您. The app is
  a computer app first, so 你, and one form only. Where a sentence reads naturally with no
  pronoun, leave it out (most do).
- **Loan words**: VPN, IP, DNS, GB, AI, LAN stay in Latin letters. Put one half-width space between
  Chinese characters and Latin letters or digits (`VPN 服务`, `5 GB`), as the system does.
- **Numbers**: Western digits. Grouping by the system formatter (1,234.5). Do not convert to 万.
- **Dates and times**: system formatter (2026年11月16日, 24-hour clock).
- **Punctuation**: full-width Chinese marks inside Chinese text (，。：；？！（）“”). The
  ellipsis is `…` as in the English source. No space before or after full-width marks.
- **Buttons**: verb first, no final punctuation (连接, 领取退款).
- **Plurals**: Chinese has none; one form for every count.

## hi — Hindi

- **Address**: आप with its verb forms (करें, चुनें). Never तुम or तू.
- **Script**: Devanagari. Everyday technical loan words are written in Devanagari as phones and
  stores write them (वॉलेट, सर्वर, रिफ़ंड), not replaced by formal Sanskrit coinages (सहेजें is
  the one formal word kept where it is the system's own). Keep the nukta in फ़, ज़ where the
  source word has f or z (रिफ़ंड, फ़्रेज़).
- **VPN and IP**: written वीपीएन and आईपी in Devanagari, as the phone system does in its
  settings and help text (it keeps Latin "VPN" only in headings). One form in the app: वीपीएन.
- **Latin kept**: DNS, GB, AI, and every never-translated name.
- **Numbers**: Western digits (0-9) as the system uses for Hindi; grouping by the system formatter
  (Indian grouping, 1,23,456).
- **Dates**: system formatter.
- **Punctuation**: sentences end with the danda `।`; other marks as in English. Buttons have no
  final mark.
- **Plurals**: through the plural helper; nouns change in the oblique plural (टोकन stays, सर्वरों).

## es — Spanish

- **One Spanish for all regions**: neutral wording that reads right in Spain and the Americas.
  Where the regions split (billetera / cartera, computadora / ordenador) take the word with the
  most live uses and avoid the other; prefer a neutral word (equipo) where one exists.
- **Address**: tú, as phone systems and consumer apps do. Imperatives in tú (Elige, Conecta).
- **Loan words**: VPN, IP, DNS, LAN, proxy stay; "app" is fine. Kill switch is translated
  (Interruptor de bloqueo), as VPN apps do on screen.
- **Settings** is Ajustes (the phone system and VPN apps); never mix in Configuración.
- **Numbers**: system formatter (es: 1234,5 / 12.345,5). Unit after a space: `5 GB`, `0,5 SOL`.
- **Dates**: system formatter, 24-hour clock.
- **Punctuation**: opening ¿ and ¡ always. Lower-case after the first word in titles and
  buttons (Elige un servidor, not Elige Un Servidor).
- **Gender**: avoid gendered adjectives about the person; state the thing (Conexión protegida).

## fr — French

- **Address**: vous, as the system does. Imperatives in the vous form are avoided on buttons:
  buttons use the infinitive (Se connecter, Annuler).
- **Loan words**: VPN, IP, DNS, LAN, proxy stay; "split tunneling" stays as apps write it.
  Kill switch is translated (Coupe-circuit), as VPN apps do on screen. Data units in French form: Go, Mo (not GB, MB) — the unit is formatted, not typed.
- **Numbers**: system formatter (1 234,5 with a narrow no-break space).
- **Dates**: system formatter, 24-hour clock.
- **Punctuation**: no-break space before `: ; ? !` and inside « ». Use « » for quotes.
- **Capitals**: only the first word of a title or button.

## pt — Portuguese (Brazil)

- **Variety**: Brazilian Portuguese, the largest by far. European forms are not used (ligar,
  definições, guardar, partilha, telemóvel, ecrã).
- **Address**: você with third-person verbs; buttons in the infinitive (Conectar, Salvar).
- **Loan words**: VPN (feminine: a VPN), IP, DNS, LAN, proxy, app, kill switch stay as the
  systems and VPN apps write them.
- **Numbers**: system formatter (1.234,5). Unit after a space: `5 GB`, `0,5 SOL`.
- **Dates**: system formatter, 24-hour clock.
- **Capitals**: only the first word of a title or button.
- **Gender**: state the thing, not the person (Conexão protegida).

## ru — Russian

- **Address**: вы, lower case. Buttons use the verb as the systems do (Подключиться, Сохранить).
- **Loan words**: VPN, IP, DNS stay Latin; data units in Cyrillic (ГБ, МБ) from the formatter.
- **Kill switch** is translated (Аварийное отключение), as one VPN app does on screen.
- **Letter ё**: write е, as the systems mostly do, except where a word would be misread.
- **Numbers**: system formatter (1 234,5 with a no-break space).
- **Dates**: system formatter, 24-hour clock.
- **Plurals**: three forms (one, few, many) through the plural helper; never write "(ы)".
- **Punctuation**: « » for quotes; a dash, not a hyphen, between parts of a sentence.

## de — German

- **Address**: Sie, as the systems do. Buttons in the infinitive (Verbinden, Speichern).
- **Loan words**: VPN (neuter: das VPN), IP, DNS, LAN, App, Proxy, Firewall, Browser, Wallet,
  Kill Switch stay as the systems and apps write them. Compounds after an abbreviation take a
  hyphen (VPN-Dienst, IP-Adresse, RPC-Endpunkt).
- **Numbers**: system formatter (1.234,5). Unit after a space: `5 GB`, `0,5 SOL`.
- **Dates**: system formatter, 24-hour clock.
- **Punctuation**: „ “ for quotes. A space before the ellipsis only where the systems put one.
- **Length**: German runs long; prefer the shorter of two correct words on buttons.

## ja — Japanese

- **Address**: polite です・ます in sentences; no pronoun for the reader. Buttons are nouns or
  short verb phrases (接続, 保存, テストを実行).
- **Loan words**: katakana as the systems write them (サーバー, プロキシ, ウォレット), long vowel
  mark kept (サーバー, not サーバ). VPN, IP, DNS, GB, AI, LAN stay in Latin letters with a
  half-width space before and after inside Japanese text (VPN サービス).
- **Numbers**: Western digits; system formatter (1,234.5).
- **Dates**: system formatter (2026年11月16日), 24-hour clock.
- **Punctuation**: full-width 。、「」; no space around them. Ellipsis `…`.
- **Plurals**: none; one form for every count.

## bn — Bengali

- **Address**: আপনি with its verb forms (করুন, বেছে নিন). Never তুমি or তুই.
- **Script**: Bengali. Everyday technical loan words are written in Bengali script as the phone
  system writes them (কানেক্ট, সার্ভার, সেটিংস, সেভ), not replaced by formal coinages.
- **VPN** stays in Latin letters, as the phone system writes it; IP is written আইপি.
- **Latin kept**: VPN, DNS, GB, AI, and every never-translated name.
- **Numbers**: Bengali digits ০–৯, as store listings write them and as the formatter gives for
  bn; never typed by hand. Grouping by the formatter.
- **Punctuation**: sentences end with the dari `।`; buttons have no final mark.
- **Evidence**: thin. Only the phone system's files and help pages exist in Bengali; most money
  and VPN-feature words are unconfirmed.

## id — Indonesian

- **Address**: Anda (capital A) where a pronoun is needed; most sentences need none.
- **Words**: Pengaturan (not Setelan), Hubungkan, Terhubung, as the VPN app, the wallet and the
  computer system's help write them. Dompet for wallet.
- **Loan words**: VPN, IP, DNS, LAN, proxy, server, firewall, browser stay.
- **Numbers**: system formatter (1.234,5). Unit after a space: `5 GB`, `0,5 SOL`.
- **Dates**: system formatter, 24-hour clock.
- **Capitals**: only the first word of a title or button.
- **Plurals**: one form; never double a noun to mark plural in the interface.

## ko — Korean

- **Readers**: one Korean for readers in the South and the North. Every source found is from the
  South. Where a native Korean word and an English loan are both in use, take the word both
  sides read (설정, 연결, 지갑, 거래, 요금제); keep a loan only where no other word is in use
  (서버, 프록시, 킬 스위치).
- **Address**: polite 해요체 in sentences; no pronoun for the reader. Buttons are nouns or short
  verb phrases (연결, 저장, 테스트 실행).
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN. A space between Hangul and Latin letters only where
  the systems put one (VPN 서비스, IP 주소, GB당).
- **Numbers**: system formatter (1,234.5).
- **Dates**: system formatter (2026. 11. 16.), 24-hour clock.
- **Particles**: write the particle after a placeholder in both forms the systems allow,
  `{name}을(를)`, only where the word is not known in advance; otherwise rephrase so none follows.

## zh-Hant — Chinese (Traditional)

- **Wording**: Taiwan forms, as the shipped files use (連線, 伺服器, 設定, 網路, 帳戶, 儲存,
  搜尋, 應用程式). Mainland forms are not used.
- **Address**: 你, one form only; leave the pronoun out where the sentence reads without it.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN, Proxy. One half-width space between Chinese and Latin
  letters or digits (`VPN 服務`, `5 GB`).
- **Numbers**: Western digits; system formatter (1,234.5). Do not convert to 萬.
- **Dates**: system formatter, 24-hour clock.
- **Punctuation**: full-width marks（，。：；？！「」）; the ellipsis `…`.
- **Plurals**: none.

## ar — Arabic

- **Address**: imperative singular without a pronoun, as the system does ("اتصال" on the button; steps "انقر على", "حدد"). Avoid أنت / حضرتك; where a sentence needs a subject, use the second person singular ("عندما تكون متصلاً").
- **Loan words**: "VPN" stays in Latin letters. The system writes it as "شبكة VPN" in titles and settings ("الشبكة والإنترنت > شبكة VPN") and as bare "VPN" inside compounds ("اتصال VPN", "خدمة VPN"). "IP" stays Latin ("عنوان IP"). Protocol names stay Latin.
- **Digits**: Western digits 0–9, as the system help and store pages show.
- **Punctuation**: Arabic comma "،" and question mark "؟"; the ellipsis stays "…" after the word ("جارٍ الاتصال…").
- **Direction**: a Latin word, an address or an amount with its unit ("0.5 SOL", "50 tDVPN", "WireGuard") is one left-to-right run inside the sentence; wrap it in direction isolates in code. A sentence that ends in a Latin run still ends with Arabic punctuation outside the run.
- **Definite article on labels**: buttons take the bare noun ("اتصال", "حفظ", "إلغاء"); screen and section titles take the article ("الإعدادات", "الخادم").

## fa — Persian

- **Address**: formal plural "شما" with plural verbs, as the system help does ("روی **اتصال** ضربه بزنید", "وقتی متصل باشید").
- **Loan words**: "VPN" stays in Latin letters, with Persian plural suffix when needed ("VPNها"). "IP" stays Latin ("نشانی IP"). Proxy is "پروکسی" (system spelling; "پراکسی" is an accepted variant).
- **Digits**: Extended Arabic-Indic digits ۰–۹ in running text, as the system help writes ("مرحله ۱", "بیش از ۲۰ سال"). Amounts with a Latin unit keep the digits next to the unit inside the isolated run. Amounts use ۰–۹ everywhere, as the system does, through the formatter (fa locale).
- **Half-space (ZWNJ)**: required in "می‌", "‌ها", "‌شده" ("محافظت‌شده", "تنظیمات VPN"); a missing half-space is an error.
- **Punctuation**: Persian comma "،", question mark "؟", "…" after the word.
- **Direction**: as Arabic: Latin words, addresses and amount+unit are one isolated left-to-right run.

## ur — Urdu

- **Address**: respectful "آپ" with "کریں" imperatives, as the system strings do ("منسلک کریں", "محفوظ کریں", "منسوخ کریں").
- **Loan words**: "VPN" and "IP" stay Latin ("ہمیشہ آن VPN", "IP پتہ"). The system prefers native words where they exist (منسلک for connect, ترتیبات for settings, پتہ for address); VPN-app pages write English loans in Urdu script (سرورز, ٹنل, اسپلٹ ٹنلنگ). Rule: system word first; loan in Urdu script only where the system has none.
- **Digits**: Western digits 0–9, as the help and store pages show.
- **Punctuation**: Urdu full stop "۔", comma "،", question mark "؟".
- **Direction**: as Arabic. Nastaliq script needs extra line height; check long-text pictures. Path arrows in running text point left ("بٹوہ ← یہ ڈیوائس"); a technical mapping between Latin placeholders keeps "→".
- **On chain**: always "بلاک چین" in full ("رقوم بلاک چین پر رہتی ہیں"). A bare "چین" reads "China".
- **Refund**: the money comes to the user: "رقم … اپنے والیٹ میں واپس لیں". Never "واپس کریں", which reads as the user giving the deposit back and is the Back button.

## ps — Pashto

- **Address**: respectful plural "تاسو" with plural imperatives ("وټاکئ", "ترلاسه کړئ").
- **Loan words**: "VPN" and "IP" stay Latin. No system translation exists; the open-source VPN client writes "نښلول" (connect) and "امستنې" (settings).
- **Digits**: not settled by evidence; default Western 0–9 until an in-country page shows otherwise.
- **Punctuation**: Arabic-script comma "،" and question mark "؟"; Pashto full stop "."
- **Direction**: as Arabic. Pashto letters ټ ډ ړ ښ ږ ځ must draw; check the font list on every system.
- **On chain**: always "بلاکچین" ("پیسې په بلاکچین کې پاتې کېږي"). A bare "چین" reads "China".

## ckb — Kurdish (Sorani)

- **Address**: pronoun-free imperative singular ("بگەڕێ", "هەڵبژێرە"), as the encyclopedia and browser interfaces do.
- **Loan words**: "VPN" and "IP" stay Latin ("ناونیشانی IP"). Server: native "ڕاژەکار" (encyclopedia and browser); "سێرڤەر" accepted.
- **Digits**: not settled by evidence; default Western 0–9.
- **Script**: Sorani letters ڕ ڵ ۆ ێ ە must draw; "ھ" (U+06BE) and "ه" (U+0647) both appear in sources — normalise to one in the language file.
- **Direction**: as Arabic. No system help exists in Sorani.
- **On chain**: always "بلۆکچەین" ("پارەکە لەسەر بلۆکچەین دەمێنێتەوە"). A bare "چین" reads "China".

## tr — Turkish

- **Address**: siz forms in sentences; buttons in the bare imperative as the systems do
  (Bağlan, Kaydet, İptal).
- **Letters**: dotted and dotless i are different letters (İ/i, I/ı). Upper-casing goes through
  the Turkish locale, never a plain upper-case call.
- **Loan words**: VPN, IP, DNS, LAN, proxy, kill switch stay. A suffix after an abbreviation or
  name takes an apostrophe and follows its sound (VPN'e, IP'niz, Solana'da).
- **Numbers**: system formatter (1.234,5). Unit after a space: `5 GB`, `0,5 SOL`.
- **Dates**: system formatter, 24-hour clock.
- **Placeholders**: rephrase so no suffix attaches to a placeholder whose word is not known.

## vi — Vietnamese

- **Address**: bạn where a pronoun is needed; most sentences need none.
- **Cài đặt**: means both Settings and Install. It is used alone only for Settings; install is
  always written with its object (Cài đặt dịch vụ VPN).
- **Loan words**: VPN, IP, DNS, LAN, proxy, Internet stay.
- **Numbers**: system formatter (1.234,5). Unit after a space.
- **Dates**: system formatter, 24-hour clock.
- **Tone marks**: one placement throughout the file (hóa, not mixed with hoá); the term check
  accepts both.
- **Plurals**: none; one form for every count.

## uk — Ukrainian

- **Address**: ви, lower case.
- **Connect**: під’єднатися / під’єднано, as the system writes it; never mixed with підключити in
  one file.
- **Apostrophe**: ’ (U+2019) in every word that takes one (під’єднано, комп’ютер).
- **Latin kept**: VPN, IP, DNS, LAN in Latin letters (the system's ІР in Cyrillic letters is not
  copied). Data units in Cyrillic (ГБ, МБ) from the formatter.
- **Kill switch**: Аварійний вимикач, as one VPN app writes it.
- **Numbers**: system formatter (1 234,5 with a no-break space).
- **Dates**: system formatter, 24-hour clock.
- **Plurals**: three forms (one, few, many) through the plural helper.

## it — Italian

- **Address**: tu, as phone systems and consumer apps do. Buttons in the imperative (Connetti,
  Salva, Annulla).
- **Loan words**: VPN (feminine: la VPN), IP, DNS, LAN, app, server, proxy, browser, kill switch,
  split tunneling, wallet stay as the systems and apps write them.
- **Numbers**: system formatter (1.234,5). Unit after a space.
- **Dates**: system formatter, 24-hour clock.
- **Capitals**: only the first word of a title or button.

## pl — Polish

- **Address**: second person singular or impersonal, as the systems do. Buttons in the
  imperative (Połącz, Zapisz, Anuluj).
- **Loan words**: VPN, IP, DNS, LAN, kill switch, split tunneling stay. Wallet is Portfel.
- **Numbers**: system formatter (1 234,5 with a no-break space).
- **Dates**: system formatter, 24-hour clock.
- **Plurals**: three forms (one, few, many) through the plural helper.

## nl — Dutch

- **Address**: je, as phone systems and consumer apps do. Buttons in the infinitive
  (Verbinden, Opslaan, Annuleren).
- **Loan words**: VPN, IP, DNS, LAN, app, server, proxy, browser, wallet, killswitch,
  split tunneling stay. A compound after an abbreviation takes a hyphen (IP-adres, VPN-service).
- **Numbers**: system formatter (1.234,5). Unit after a space.
- **Dates**: system formatter, 24-hour clock.

## ro — Romanian

- **Address**: tu, as the phone system does.
- **Letters**: comma-below ș ț, never cedilla ş ţ.
- **Loan words**: VPN, IP, DNS, LAN, server, proxy, browser, kill switch stay.
- **Numbers**: system formatter (1.234,5). Unit after a space.
- **Plurals**: three forms (one, few, other) through the plural helper; "de" before the noun from
  20 up comes from the plural form, not from code.

## az — Azerbaijani

- **Script**: Latin (ə, ğ, ı, ö, ş, ü, ç). Upper-casing through the Azerbaijani locale (i → İ).
- **Address**: siz with polite imperatives in sentences; buttons as the system writes them.
- **Loan words**: VPN, IP, DNS, LAN stay. A suffix after an abbreviation takes an apostrophe
  (VPN'siz).
- **Numbers**: system formatter (1.234,5).
- **Evidence**: only the phone system's files exist in this language. Every other word is the
  plainest everyday one, unconfirmed.

## uz — Uzbek

- **Script**: Latin, as the phone system writes it. Use ‘ (U+2018) in o‘ and g‘ and ’ for the
  glottal stop (sun’iy), as the system does.
- **Address**: siz with polite forms; buttons as verbal nouns as the system writes them (Saqlash,
  Bekor qilish).
- **Loan words**: VPN, IP, DNS, LAN stay.
- **Numbers**: system formatter (1 234,5).
- **Evidence**: only the phone system's files exist; the rest is plain wording, unconfirmed.

## sw — Swahili

- **Address**: second person singular imperative, as the system does (Unganisha, Hifadhi).
- **Loan words**: VPN, IP, DNS, LAN stay. Proxy is Seva mbadala, as the system writes it.
- **Numbers**: system formatter (1,234.5).
- **Evidence**: the phone system and one wallet only; the rest is plain wording, unconfirmed.

## am — Amharic

- **Script**: Ethiopic. VPN, IP and GB stay in Latin letters, joined to the Ethiopic prefix as
  the system writes them (የIP አድራሻ, የVPN አገልግሎት).
- **Address**: imperative on buttons as the system does (አስቀምጥ, ተመለስ); polite እርስዎ forms in
  sentences.
- **Numbers**: Western digits from the formatter; never Ethiopic numerals.
- **Punctuation**: sentences end with ። ; comma ፣ .
- **Evidence**: the phone system and one wallet only; the rest is plain wording, unconfirmed.

## om — Oromo

- **Script**: Latin (Qubee). The apostrophe marks the glottal stop (ba'i, Olkaa'i); double
  letters are long sounds and must not be shortened.
- **Address**: polite plural keessan in sentences; singular imperative on buttons (Barbaadi,
  Filadhu, Itti fufi).
- **Loan words**: VPN, IP, DNS, LAN stay; other loans in Qubee spelling (Appii, Sarvarii).
- **Numbers**: Western digits from the formatter.
- **Evidence**: no system, VPN-app or wallet translation exists. Every term is the plainest
  everyday wording, unconfirmed, and waits on pages read from inside the country.

## th — Thai

- **Address**: no pronoun; polite neutral (no ครับ/ค่ะ on screen), as the system's settings do.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: No space between Thai words; one space between Thai and Latin letters or digits (ที่อยู่ IP, 5 GB). Ellipsis … as in the source.
- **Numbers and dates**: system formatter.

## ms — Malay

- **Address**: anda (lower case mid-sentence), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Malaysian Malay, not Indonesian (pelayan not server, tetapan not pengaturan). Sentence case in titles and buttons.
- **Numbers and dates**: system formatter.

## fil — Filipino

- **Address**: follow the system: ka / mo / iyong, never po/opo on screen (the system's help says "Kapag nakakonekta ka na").
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Tagalog grammar with English tech loans as the system writes them (wallet, refund, subscription, network, server). Loan verbs with a hyphen: I-save, I-reset, Mag-import.
- **Numbers and dates**: system formatter.

## my — Burmese

- **Address**: polite neutral, no pronoun; verbs end as the system does (…ရန် on buttons, …ပါသည် in states).
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Unicode Burmese only, never the older non-Unicode font encoding. Digits: the system formatter decides (in-country listings use Burmese digits ၀–၉). Wallet, private key and blockchain stay in Latin letters, as the in-country wallet listing writes them.
- **Numbers and dates**: system formatter.

## km — Khmer

- **Address**: polite neutral, no pronoun, as the system's settings do.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Khmer has no spaces between words; the system puts a zero-width space (U+200B) at word breaks so lines wrap. A normal space only between phrases and around Latin letters or digits (អាសយដ្ឋាន IP).
- **Numbers and dates**: system formatter.

## mr — Marathi

- **Address**: तुम्ही with its verb forms (करा, निवडा), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Devanagari. The system keeps VPN in Latin letters but writes आयपी. Everyday loans in Devanagari as phones write them (सर्व्हर, अ‍ॅड्रेस, ॲप). Compare words after Unicode NFC and with ZWJ/ZWNJ removed: the system mixes अ‍ॅ and ॲ.
- **Numbers and dates**: system formatter.

## te — Telugu

- **Address**: మీరు with its verb forms (చేయండి, ఎంచుకోండి), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Telugu script. The system keeps VPN and IP in Latin letters. Everyday loans written in Telugu as phones write them (సర్వర్, అడ్రస్, యాప్); formal coinages only where the system itself uses them. Compare words with ZWNJ removed.
- **Numbers and dates**: system formatter.

## ta — Tamil

- **Address**: the system's short imperative on buttons (இணை, சேமி); நீங்கள் forms in sentences.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Tamil script. The system keeps VPN and IP in Latin letters and prefers Tamil words for server (சேவையகம்) and address (முகவரி); loans only where the system uses them (ஆப்ஸ், டேட்டா). புதுப்பி means Update (#106), so Refresh uses another word.
- **Numbers and dates**: system formatter.

## gu — Gujarati

- **Address**: તમે with its verb forms (કરો, પસંદ કરો), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Gujarati script. The system keeps VPN and IP in Latin letters. Everyday loans written in Gujarati as phones write them (સર્વર, ઍડ્રેસ, ઍપ). The system writes ઍ and ૉ for English vowels (ઍપ, બ્લૉક); keep that spelling.
- **Numbers and dates**: system formatter.

## pa — Punjabi

- **Address**: ਤੁਸੀਂ with its verb forms (ਕਰੋ, ਚੁਣੋ), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Gurmukhi script (India). The system keeps VPN and IP in Latin letters and writes ਪਤਾ for address. Compare words after Unicode NFC: the same word reaches the files with the nukta both precomposed and as a separate mark (ਜ਼ / ਜ਼).
- **Numbers and dates**: system formatter.

## ha — Hausa

- **Address**: singular imperative on buttons (Soke, Ajiye, Ci gaba), as the shipped browser and encyclopedia-app files do; ka/ki avoided in sentences by using the impersonal form where possible.
- **Latin kept**: VPN, IP, DNS, GB, SOL, tDVPN, AI.
- **Writing and evidence**: Latin script (Boko) with hooked letters ɓ ɗ ƙ and the apostrophe y'. No phone-system translation exists. Evidence: a browser maker's translation memory across several projects, the encyclopedia app and the encyclopedia interface. A word is confirmed when two distinct shipped sources agree. Money and VPN words rest on everyday wording, unconfirmed, waiting on an in-country round (NG).
- **Numbers and dates**: system formatter.

## yo — Yoruba

- **Address**: singular imperative on buttons (Parẹ́, Fipamọ́, Tẹ̀síwájú), as the shipped browser files do; polite ẹ in sentences.
- **Latin kept**: VPN, IP, DNS, GB, SOL, tDVPN, AI.
- **Writing and evidence**: Latin script with tone marks and underdots (ẹ ọ ṣ; à á è é ì í ò ó ù ú). Tone marks are required; a word without them is a different word. No phone-system translation exists. Evidence: a browser maker's translation memory across several projects and the encyclopedia interface. Shipped files spell some words several ways (Ààtò/Aatò); the toned spelling is chosen. Money and VPN words are everyday wording, unconfirmed, waiting on an in-country round (NG).
- **Numbers and dates**: system formatter.

## ig — Igbo

- **Address**: singular imperative on buttons (Kagbuo, Chekwaa, Chọọ), as the shipped browser files do; polite unu avoided, singular gị in sentences.
- **Latin kept**: VPN, IP, DNS, GB, SOL, tDVPN, AI.
- **Writing and evidence**: Latin script with ị ọ ụ ṅ; tone marks are optional in interface text and the shipped files mostly leave them out, so this sheet leaves them out. No phone-system translation exists. Evidence: a browser maker's translation memory across several projects and the encyclopedia interface. English loans are common for technical words (VPN, sava). Money and VPN words are everyday wording, unconfirmed, waiting on an in-country round (NG).
- **Numbers and dates**: system formatter.

## pcm — Nigerian Pidgin

- **Address**: plain imperative on buttons; "you" in sentences (pidgin has no polite form).
- **Latin kept**: VPN, IP, DNS, GB, SOL, tDVPN, AI.
- **Writing and evidence**: Latin script. Pidgin is English-based: most technical words stay English, and the work is in the sentences (dey = is/are -ing, don = has, no fit = cannot, make = let). One translation project spells phonetically (Kontinu, Revyu, Langwejs); this sheet keeps everyday English spelling because that is what people read on phones and in news writing, and the phonetic spellings are listed as forms. Every row is unconfirmed, waiting on an in-country round (NG).
- **Numbers and dates**: system formatter.

## kmr — Kurdish (Kurmanji)

- **Address**: singular imperative on buttons (Betal bike, Tomar bike, Lê bigere), as the shipped browser and app files do; tu in sentences.
- **Latin kept**: VPN, IP, DNS, GB, SOL, tDVPN, AI.
- **Writing and evidence**: Latin script (Hawar alphabet: ç ê î ş û). No phone-system translation exists. Evidence: a browser maker's translation memory across several projects, the encyclopedia interface and an open-source app store client. A word is confirmed when two distinct shipped projects agree. Verbs on buttons take "bike" (do) after a noun.
- **Numbers and dates**: system formatter.

## kn — Kannada

- **Address**: ನೀವು with its verb forms (ಮಾಡಿ, ಆಯ್ಕೆಮಾಡಿ), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Kannada script. The system keeps VPN and IP in Latin letters and writes ವಿಳಾಸ for address. Everyday loans in Kannada script as phones write them (ಸರ್ವರ್, ಆ್ಯಪ್). Compare words with ZWJ/ZWNJ removed.
- **Numbers and dates**: system formatter.

## ml — Malayalam

- **Address**: the system's -ുക verb form on buttons (തുടരുക, റദ്ദാക്കുക); നിങ്ങൾ in sentences.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Malayalam script (chillu letters as the system writes them). The system keeps VPN and IP in Latin letters and writes വിലാസം for address. Compare words with ZWJ/ZWNJ removed; the files mix ങ്ങള്‍ and ങ്ങൾ.
- **Numbers and dates**: system formatter.

## or — Odia

- **Address**: ଆପଣ with its verb forms (କରନ୍ତୁ), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Odia script. Only the phone system ships Odia among the shipped files, so every row is single-source until the translation memory and in-country pages land. The system keeps VPN and IP in Latin letters and writes ଠିକଣା for address.
- **Numbers and dates**: system formatter.

## ne — Nepali

- **Address**: तपाईं with its verb forms (गर्नुहोस्), as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Devanagari, Nepali spelling (not Hindi): सेटिङ, एप, डिभाइस. Only the phone system ships Nepali among the shipped files, so every row is single-source until the translation memory and in-country pages land. VPN and IP stay in Latin letters.
- **Numbers and dates**: system formatter.

## si — Sinhala

- **Address**: polite -න්න verb form on buttons (සුරකින්න), no pronoun, as the system does.
- **Latin kept**: VPN, IP, DNS, GB, AI, LAN.
- **Writing**: Sinhala script. The system uses native Sinhala words, not loans (සේවාදායකය server, යෙදුම් apps, සැකසීම් settings). Only the phone system ships Sinhala among the shipped files, so every row is single-source until the translation memory and in-country pages land. The system's proxy word නියුතු is kept.
- **Numbers and dates**: system formatter.
