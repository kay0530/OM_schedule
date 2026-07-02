# Construction Schedule (パワまる工事予定表)

## 🔄 セッション引き継ぎ（最終更新: 2026-07-01）

**この日の3機能はすべて main にマージ済み・本番稼働中。**

### 1. 活動報告エクスポート（管理部・唐さん向け）
- ヘッダー「活動報告」ボタン → 期間指定 → **全メンバーのOutlook予定“本文”の作業報告テンプレ**（移動時間/作業時間/作業者名/作業内容/残タスク）を解析し **1案件1行・記入済みのみ**で `.xlsx` ダウンロード。列に **記載者**（どのメンバーの予定に入っていたか）を含む。
- 実装: `src/services/reportParser.js`（表記ゆれ吸収・4実サンプルで検証）, `reportExportService.js`（SheetJS遅延読込）, `ReportExportModal.jsx`, Graph `fetchMemberEventsWithBody`（`Prefer: outlook.body-content-type="text"`）。AIクレジット不使用・運用者のGraphトークンで完結。
- **瀬戸さんはOutlookに本文が無いため対象外**（他9名）。

### 2. Firestore ロックダウン（セキュリティ・完了）
- **ルール本番化** (`firestore.rules` + `firebase.json`): `request.auth != null` で認証必須、`om-schedule-sf-data` はクライアント読取専用（書込は Admin のみ）。テストモード（全開放）を解消。
- **App Check（reCAPTCHA v3）＝強制ON**。サイトキーは `firebase.js` にハードコード（公開情報）。匿名認証を `firebase.js` で実行し、読み書きは `firebaseAuthReady` を待つ（`firestoreService.js`/`sfDataService.js`）。
- **CIをAdmin SDK化**: `scripts/sync-sf.mjs` は `firebase-admin` + GitHub Secret `FIREBASE_SERVICE_ACCOUNT`（サービスアカウントJSON）でルールをバイパス。
- コンソール設定: Firebase匿名認証ON / App Check reCAPTCHA登録＆Cloud Firestoreへ「適用（強制）」済 / reCAPTCHA v3キーは`kay0530.github.io`許可。
- **残る理想形（未実施・Blaze必要）**: MSAL身元→Firebaseカスタムトークン（Cloud Function）で“個人単位”の認可。現状は「認証＋App Check」の多層防御まで。

### 3. 瀬戸さんのカレンダー連携（Outlook共有カレンダー方式・完了）
- **瀬戸さんはテナントユーザーではない**（Gmail `nstandard.info@gmail.com`）。彼の実運用カレンダーは**個人MSアカウント（`outlook_8390B1F083584B14@outlook.com`）が所有し、運用者のOutlookに共有された「瀬戸 勇介」カレンダー**。運用者は編集権限あり。
- 実装: `members.js` の瀬戸に `sharedCalendarOwner: 'outlook_8390B1F083584B14@outlook.com'`（`skipOutlookSync` は削除）。`graphCalendarService.js` に **`/me/calendars/{id}` 経由**の `fetchSharedCalendarEvents` と member-aware ラッパー `createEventForMember`/`updateEventForMember`/`deleteEventForMember`（calendarId は所有者アドレスで実行時解決＋キャッシュ）。全書込4箇所（Assign/QuickAdd/EventDetail/App削除）＋読取sweepがラッパー経由。
- **イベントIDは通常のOutlook ID**なので `outlookEventId`・突合・dedup・チップ表示は無改造で流用。
- **運用上の唯一の例外**: 瀬戸さんの同期は「操作者のOutlookに瀬戸カレンダーが共有追加済み」が前提。他の人がアプリで瀬戸さんを操作するなら、その人が一度自分のOutlookに追加する必要あり。
- **Googleは棚上げ（不採用）**: `feat/google-calendar-sync` ブランチ・Google Cloud OAuth（`OM-schedule`プロジェクト）・reCAPTCHAは**未使用**（書込先が違ったため）。削除して良いが害なし。`plan-google-calendar-sync.md` はその検討記録。

### 直近の小修正（既済み）
- ダークモードで `<select>` の候補リストが白背景で読めない → `index.css` で option を着色。
- コピーモード（Ctrl+C）中にヘッダーの日付送りが押せない → バナー表示中は固定ヘッダー群を `bannerOffset` で押し下げ。

### 未対応・任意
- ファビコン `vite.svg` 404（無害）。
- `npm run lint` は `eslint.config.js` 欠落で動かない（別途タスク化済み）。

---

## Project Overview
Excel ベースの「パワまる工事仮組予定表」を置き換える React SPA。施工メンバーの予定を週次・月次カレンダーで可視化し、Salesforce 商談/点検修繕 + Outlook 予定表 + Firestore リアルタイム共有を統合する。

## Deployment
- **GitHub Pages**: https://kay0530.github.io/OM_schedule/
- **Repository**: https://github.com/kay0530/OM_schedule
- GitHub Actions で main push 時に自動デプロイ (`.github/workflows/deploy.yml`)
- Firebase 環境変数は GitHub Secrets に設定済み

## Tech Stack
- **Runtime**: React 19.2 + Vite 7.3.1
- **Styling**: Tailwind CSS 4.2 (via `@tailwindcss/vite`)
- **Auth**: MSAL Browser 5.3 + MSAL React 5.0 (Azure AD SPA)
- **Backend**: Firebase Firestore (リアルタイム共有)
- **Package Manager**: npm
- **Language**: JavaScript (JSX)

## Dev Server
```bash
npm run dev     # http://localhost:5191
npm run build   # dist/ に出力
npm run sync-sf # Salesforce 商談+点検修繕データ同期
```

## File Structure
```
src/
├── main.jsx                    # Entry point
├── App.jsx                     # Root component, view routing, copy/paste, Outlook reconcile
├── firebase.js                 # Firebase initialization (env-based config)
├── index.css                   # Tailwind 4 + テーマトークン (:root / [data-theme=dark]) + event chip CSS
├── context/
│   ├── AppContext.jsx          # Assignments + settings (localStorage + Firestore sync, tombstones/pendingAdds)
│   ├── AuthContext.jsx         # MSAL auth state
│   ├── CalendarContext.jsx     # Outlook calendar events
│   └── SfDataContext.jsx       # SFデータ (商談/自家消費/点検修繕) のFirestore購読
├── services/
│   ├── msalService.js          # MSAL instance factory, login/logout, config persistence
│   ├── graphCalendarService.js # Graph API: fetch/create/update/delete calendar events (DELETE 404=成功扱い)
│   ├── calendarService.js      # Calendar data transformation
│   ├── firestoreService.js     # Firestore CRUD: assignments + filter presets (real-time sync)
│   ├── sfDataService.js        # SFデータ購読 (om-schedule-sf-data, チャンク再結合)
│   └── githubSyncService.js    # 手動SF同期: GitHub Actions workflow_dispatch (PATはlocalStorage)
├── hooks/
│   ├── useCalendarSync.js      # Outlook sync hook
│   └── useModalDrag.js         # モーダルのドラッグ移動 (全モーダル共通)
├── data/
│   ├── members.js              # 10名 + 納品(powermaru@altenergy.co.jp, delivery疑似メンバー)
│   ├── statusTypes.js          # Status types (不可, 休み, 移動, 現場)
│   └── workCategories.js       # 作業種別カタログ + タイトル【...】プレフィックス解析
│   # ⚠️ SFデータ(JSON)はリポジトリに置かない — Firestoreから配信 (公開リポジトリのため)
├── utils/
│   ├── dateUtils.js            # Date/time helpers
│   ├── colorUtils.js           # getContrastText (YIQ, チップ文字色)
│   └── eventLayout.js          # 重複イベントのレーン割付 (Outlook風横並び)
├── components/
│   ├── layout/                 # MainLayout / Header (ナビ一本化+テーマ切替) / Sidebar
│   ├── schedule/               # Weekly/Daily/Monthly + EventBlock + 各モーダル + StatusOverlay + AllDayOverlay
│   ├── jobs/                   # JobPanel (SF同期ボタン付き) + JobCard
│   ├── settings/               # SettingsView (テーマ/Azure AD/SF同期+GitHubトークン/データ管理)
│   ├── shared/                 # Toast / ThemeApplier / FilterPopover
│   └── auth/                   # LoginGate
scripts/
└── sync-sf.mjs                 # Salesforce CLI sync → Firestore直書き (レンタル+自家消費+点検修繕)
```

## SF データ同期アーキテクチャ (2026-06-12 Firestore化)
- `sync-sf.yml` (30分cron + workflow_dispatch) が SF CLI でクエリ → **Firestore `om-schedule-sf-data` コレクションに直接書込**（リポジトリへのコミット・再デプロイは廃止）
- ドキュメント構造: `meta` (syncedAt/件数/chunks) + `<dataset>-<i>` (`records`配列, 200件/チャンク)。全docを単一バッチでatomicに更新、縮小時は余剰チャンク削除
- アプリは `SfDataContext` が `onSnapshot` で購読 → **同期結果は再読込なしで即時反映**
- 手動同期: JobPanelの🔄 → workflow_dispatch → run完了待ち(~1分) → Firestore経由で自動反映。要Fine-grained PAT(設定画面で端末ごと保存)
- `npm run sync-sf` のローカル実行には `.env` の VITE_FIREBASE_* が必要（CIはGitHub Secrets）
- **顧客データをリポジトリに入れないこと**（Public。2026-06-12にgit履歴からも全除去済み・force push実施）

## Key Features

### カレンダービュー
- **週間ビュー** (デフォルト): 0:00〜24:00全時間帯, 8:00に自動スクロール
  - **日付軸**: 曜日が主列、メンバーがサブ列 (localStorage保存)
  - **人軸**: メンバーが主列、曜日がサブ列 (Outlook風)
  - メンバーフィルターチップでオン/オフ切替
  - ビューポート高さに収まり、ヘッダー固定+グリッドスクロール
- **月間ビュー**: メンバー×週のグリッド、全幅使用、メンバーフィルター付き

### 予定の入力方法
1. **案件パネルからドラッグ&ドロップ** → AssignModal (ドラッグ中はEventBlock無効化)
2. **案件パネルでクリック選択** → スロットクリックで配置 (オレンジバナー表示)
3. **スロットをダブルクリック** → QuickAddModal (手動入力)
4. **案件パネルで案件を直接クリック** → AssignModal

### 予定の編集
- イベントクリック → EventDetailModal → 編集モード
- 手動割当: タイトル/日付/時間/担当者を変更、削除
- Outlookイベント: Graph API PATCH/DELETE で反映

### Outlook 連携
- Header の「Outlook同期」ボタンで Graph API 経由で全メンバーのカレンダーを取得
- 割当時「Outlookに登録」→ `/users/{email}/events` で各メンバーのカレンダーに直接作成
- 瀬戸 (Gmail) は `skipOutlookSync: true` で同期対象外

### Firestore リアルタイム共有
- **割当 (assignments)**: `om-schedule-assignments` コレクション → 全ユーザー間で即時同期
- **保存期間180日**: 割当は単一doc（1MiB上限）のため、書込時に180日より古い割当を自動削除（`ASSIGNMENT_RETENTION_DAYS`、デバウンス保存のflushが唯一の書込経路）。過去予定の正本はOutlook/SF。保存失敗・800KB超警告はヘッダーにピル表示、設定>データ管理にユーザー向け明記あり
- **フィルタープリセット**: `om-schedule-filter-presets` コレクション → 共有
- **SFデータ**: `om-schedule-sf-data` コレクション → 同期ワークフローが書込、全ユーザーへ即時配信
- localStorage フォールバック (Firebase未設定時、SFデータは除く)

### フィルタープリセット
- ステージ/ステータスの選択状態を名前付きで保存
- 保存済みプリセットをワンクリックで適用
- 最終フィルター状態を自動復元

## Data Sources

### Salesforce
```sql
-- レンタル商談
SELECT Id, Name, StageName2__c, ConstractType__c, Account.Name,
       LocationAddress__c, KojiSekouyoteibi__c, KojiSekoukiboubi__c,
       Kankobi__c, ConstructionCategory__c, ConstUser__c,
       AllSchaduleBikou__c, OwnerId
FROM Opportunity
WHERE ConstractType__c = 'レンタル'
  AND StageName2__c NOT IN ('失注', 'ペンディング', '99_完了')

-- 点検／修繕
SELECT Id, Name, Status__c, Category__c, Direction__c, Field2__c,
       Account__c, ScheduledDate__c, ExecEndDate__c, ExecDateKakutei__c,
       LocationAddress__c, Content__c, Result__c,
       Maintainer1__c, Maintainer2__c, Maintainer3__c,
       Opportunity__c, Gaiyou__c, OwnerId
FROM Maintenance__c
WHERE Status__c NOT IN ('完了')
```

## Members (10名 + 納品カレンダー)
| ID | 名前 | メール | 色 | 備考 |
|----|------|--------|-----|------|
| hiroki_n | 廣木 | norifumi.hiroki@altenergy.co.jp | #3B82F6 | |
| yodogawa_t | 淀川 | taichi.yodogawa@altenergy.co.jp | #06B6D4 | |
| tano_h | 田野 | hayato.tano@altenergy.co.jp | #10B981 | |
| bold_j | BOLD | jigjidsuren.bold@altenergy.co.jp | #F97316 | |
| sasanuma_k | 笹沼 | kazuhiro.sasanuma@altenergy.co.jp | #F59E0B | |
| yamazaki_k | 山崎 | kaito.yamazaki@altenergy.co.jp | #EC4899 | |
| ota_t | 太田 | takahiro.ota@altenergy.co.jp | #EF4444 | |
| wano_t | 和埜 | tatsuto.wano@altenergy.co.jp | #8B5CF6 | |
| seto_r | 瀬戸 | nstandard.info@gmail.com | #14B8A6 | Gmail, skipOutlookSync |
| tago_s | 田子 | shoichiro.tago@altenergy.co.jp | #A855F7 | 準備要員 |
| delivery | 納品 | powermaru@altenergy.co.jp | #D97706 | 納品専用カレンダー（疑似メンバー） |

## State Management
- **AppContext** -- `useReducer` + Firestore real-time sync
  - Actions: `ADD_ASSIGNMENT`, `UPDATE_ASSIGNMENT`, `UPDATE_ASSIGNMENTS_BULK`, `DELETE_ASSIGNMENT`, `SET_ASSIGNMENTS`, `UPDATE_SETTINGS`
  - `fromFirestoreRef` でループ防止 / デバウンス書込 / tombstone / pendingAdds（詳細は「実装上の重要な制約」参照）
  - settings: workingHours, showWeekends, colorOutlookEvents, theme, hiddenMemberIds, hiddenCategoryIds, viewAxis
  - assignment の重要フィールド: outlookEventId（Outlook連携・✓/仮判定）, groupId（複数人一括編集）, workCategory, isAllDay, isDelivery(旧)
- **CalendarContext** -- Outlook イベント管理 + localStorage 永続化
- **AuthContext** -- MSAL 認証状態

## Azure AD Config
- Client ID: `85420e2f-eb38-4a8e-931f-4be552f953b0`
- Tenant ID: `61b80e23-6dd9-4dc6-b355-d7f210b12ef5`
- Redirect URIs: `http://localhost:5191/`, `https://kay0530.github.io/OM_schedule/`
- Scopes: `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `User.Read`

## Firebase Config
- Project: `om-schedule`
- Firestore Location: `asia-northeast1` (Tokyo)
- Collections: `om-schedule-assignments`, `om-schedule-filter-presets`, `om-schedule-sf-data`
- Config: `.env` (ローカル) / GitHub Secrets (デプロイ・同期)
- Security Rules: テストモード (30日期限 → 本番ルール要設定)。**SFデータ(顧客情報)がFirestoreに載ったためルール強化の優先度UP** — Firebase AuthのMicrosoftプロバイダ連携 + ドメイン制限ルールが本命

## ⚠️ 実装上の重要な制約（ハマりどころ — 必読）
1. **EventBlock に filter系ホバー効果（hover:brightness等）を追加禁止** — CSS filter がドラッグ対象に掛かると Chromium が HTML5 ドラッグを即中断するバグがあり、割当の移動が死ぬ（一度発生→修正済み）
2. **Tailwind 4 は author の `@layer components` ブロックを出力から削除する** — チップCSS（.event-solid 等）は index.css に非レイヤーで記述。非レイヤーCSSはユーティリティに勝つため、ring/shadow と衝突する box-shadow は使わず **outline** でヘアラインを実現している
3. **flex列の整列**: ヘッダー/終日行/グリッド本体の列ラッパーは全て `flex-1 min-w-0` で統一（1つでも欠けるとチップのテキスト幅で列がズレる）
4. **Firestore 競合対策**（AppContext）: 書込は800msデバウンス / 削除は tombstone(5分TTL) / 追加は pendingAdds(60秒TTL) で保護 / **初回ロード完了前の書込は禁止**（新規端末が空配列でサーバーを潰した事故の再発防止）
5. **EventDetailModal のフィールド初期化 useEffect は `[event?.id, isOpen]` 依存のみ**（assignments を入れると Outlook自動取込で編集モードが解除される）
6. **Graph DELETE の 404 は成功扱い**（既に消えている＝成功）

## UI/UX 仕様（2026-06-12 大規模刷新後）
- **テーマ**: ライト/ダーク/システム連動。トークンは index.css の `:root` / `[data-theme=dark]`、`@theme inline` で bg-surface 等のユーティリティ生成。FOUCガードは index.html（storage key 変更時は要同期）。設定は端末ごと（Firestore非共有）
- **イベントチップ**: 同期済み=メンバー色ベタ塗り+YIQコントラスト文字(.event-solid) / 仮(未送信)=淡色+破線+ハッチ(.event-tint) / 無色Outlook・ステータス=.event-neutral。`--mc`/`--on-mc` CSS変数で着色
- **ツールバー1段**: 週ラベル+軸切替+FilterPopover(作業種別/メンバー)+Outlook色+週末トグル。フィルターは settings(hiddenMemberIds/hiddenCategoryIds/viewAxis) で全ビュー共有・永続化
- **営業時間外シェーディング**: settings.workingHours 外と週末列を減光（帯は pointer-events-none）
- **列幅**: レスポンシブ縮小で全員1画面表示（横スクロールなし。min-width強制は撤回済み）
- **コピペ**: 予定選択→Ctrl+C → 貼り付け先マスをクリック（アクセントリング表示）→ Ctrl+V で即貼付。マス未選択時のCtrl+Vは旧来の「次クリックで貼付」モード
- **モーダル**: 全モーダル（詳細/割当/手動入力）がヘッダードラッグで移動可（useModalDrag）
- **手動SF同期**: JobPanelの🔄 → GitHub Actions workflow_dispatch起動→run完了(~1分)→Firestore経由で自動反映（再読込不要）。要 Fine-grained PAT（**各自発行・共有禁止**、設定画面で端末ごとに保存）。未設定者は30分自動同期のみ
- 設計書全文: `docs-ui-redesign-spec.md`（PHASE-2未着手項目あり）

## Known Issues / TODO
- **PHASE-2（未着手、docs-ui-redesign-spec.md 参照）**: Outlook風日付ヘッダーピル(P2-1) / 現在時刻ガターチップ(P2-2) / StatusOverlayのトークン化(P2-3) / テーマlintガード(P2-5) / Sidebarメンバーリスト(P2-6) / 仮予定の一括Outlook送信(P2-7)
- 旧 `isDelivery: true` の納品予定はUI非表示（データは残存）。納品行は廃止済み、以後は「納品」メンバー(powermaru@)のカレンダーで運用
- Firestore セキュリティルール: テストモード → 本番ルールへの移行が必要。**現状はFirebase設定値を知っていればSFデータを直接読める**（設定値はバンドルに含まれる）。LoginGateはUI層のみのガード。本対策= Firebase Auth (Microsoftプロバイダ) + `@altenergy.co.jp` ドメイン制限ルール
- 瀬戸さん: Gmail ユーザーのため Outlook 同期不可、手動入力のみ
- Outlook イベント作成: `/users/{email}/events` で他ユーザーカレンダーに書込 → Calendars.ReadWrite.Shared 権限が必要
- テーマ既定値は 'light'（全画面のダーク対応が安定したら 'system' 化を検討）
- 手動SF同期を全員に開放する場合は、PAT分散ではなくサーバー側シークレット（Cloudflare Workers等の中継 + MSAL検証）構成にすること

## 直近セッション (2026-06-12 午後) の状態
- **SFデータ配信をFirestore化**: 同期のコミット/再デプロイ廃止、即時反映に。手動同期は約1分で完結
- **顧客データのPublicリポジトリからの除去（⚠️一部未完了・2026-07-02再確認）**: mainの現行ツリー+履歴はfilter-repoで除去済み（1038→96コミット、force push済み）。ただし旧履歴を指すリモート参照が一部残存しており、完全遮断には残存参照の削除＋Private化 or GitHub Supportへのpurge依頼が必要（**詳細はローカルの非公開メモ参照 — このファイルは公開リポジトリなので具体的な参照名を書かないこと**）。ミラーバックアップ: `Claude_Code_Demo/58_OM_schedule_backup-260612.git`（旧履歴保全済み）
- deploy.yml の workflow_run トリガー除去（同期ごとの再デプロイ廃止）
- **ユーザー確認待ち**: モーダルのドラッグ移動、新コピペフロー、手動SF同期ボタン（PAT発行が前提）
- 退避ブランチ `stale-confirm-date-filters`（ローカルのみ・旧履歴ベース）: 4月の未マージ機能（仮現調/完工の確定日フィールド+フィルター）。現行UIに本現調/着工確定は実装済みのため、残りが必要なら移植を検討
- 注意: 旧履歴のコミットSHAはGitHubのキャッシュに当面残存し得る（完全削除はGitHub Support依頼が必要）。リポジトリのPrivate化 or ホスティング移行（Azure Static Web Apps等）が次の本丸

## Conventions
- UI テキストは日本語、コード内コメント・変数名は英語
- Tailwind CSS でスタイリング（テーマトークン bg-surface/text-ink/border-edge 等を使用。bg-white/gray-* の直書き禁止）
- コンポーネントは default export
- Conventional Commit 形式 (feat:, fix:, refactor:)
