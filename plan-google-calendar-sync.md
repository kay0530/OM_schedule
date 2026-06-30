<!-- 自動生成: Google Calendar 双方向同期 実装プラン (workflow wf_959f20d9) 2026-06-30 -->

# 実装計画: 瀬戸さん向け Google カレンダー双方向同期 + Firestore ルール本番化

## 1. 概要

このアプリは現在、メンバーの予定を Microsoft Graph（Outlook）に対して「ライブ書き込み（作成・更新・削除）＋定期読み取り」する仕組みを持っています。瀬戸さん（`seto_r`、個人 Gmail `nstandard.info@gmail.com`）だけは `skipOutlookSync:true` で全同期から除外されており、彼の割当は永久に「下書き（リモート未登録）」のままです。本計画では、瀬戸さん専用に **Google カレンダー API による双方向ライブ同期** を追加します。やることは Outlook 経路をそっくり鏡写しにすることで、(a) Google 用の認証（GIS トークン）、(b) Google 用の読み取り/書き込みサービス、(c) どちらのメンバーをどちらの経路へ流すかを決める「振り分けフラグ」（`calendarProvider`）の 3 点が中心です。Outlook 既存コード（`graphCalendarService.js`、MSAL 周り）は**一切触らず**、横に Google 版を並べて、各呼び出し箇所で `member.calendarProvider` によって分岐させます。同時に、現在テストモード（誰でも読める）になっている Firestore のセキュリティルールを本番用に締めます。

| Outlook 側（既存・変更しない） | Google 側（今回新規に作る鏡） |
|---|---|
| MSAL（Azure AD）でログイン → `getToken()` | GIS（Google Identity Services）でログイン → `getGoogleToken()` |
| `graphCalendarService.js`（読み書き） | `googleCalendarService.js`（読み書き） |
| 宛先キー = メンバーの会社メール | 宛先キー = 瀬戸さんの共有カレンダー ID（`googleCalendarId`） |
| 割当に `outlookEventId` を保存 | 割当に `googleEventId` を保存 |
| `skipOutlookSync` で除外判定 | `calendarProvider:'google'` で振り分け |

> 補足: 瀬戸さんは「Google では読み取り対象＋書き込み有効」「Outlook/Graph には絶対に書き込まない」を両立させます。`calendarProvider:'google'` が正の振り分け、`skipOutlookSync:true` は「Graph には触るな」の意味として残します（両方を彼に付ける）。

---

## 2. 事前準備チェックリスト（コード以外）

ここが揃っていないと実装しても動きません。コードに着手する前に終わらせてください。

| # | やること | 誰が | どこで |
|---|---|---|---|
| 1 | **運用者用 Google アカウントの用意**。会社メール（@altenergy.co.jp）で作った**個人 Google アカウント**（Workspace 管理下ではない、＝外部共有制限がかからないアカウント）であることを確認。 | 田中さん（運用者本人） | Google アカウント設定 |
| 2 | **瀬戸さんから運用者アカウントへカレンダー共有**。瀬戸さんが自分の Google カレンダーを運用者アカウントに「**予定の変更権限**」（ACL の writer ロール）で共有する。閲覧のみではなく**変更権限**でないと書き込みできない。 | 瀬戸さん | Google カレンダー → 設定 → 「特定のユーザーまたはグループと共有」 |
| 3 | **共有された瀬戸カレンダーの正確な calendarId を確認**。運用者アカウントにログインし、共有された瀬戸カレンダーの ID を控える。彼のメインカレンダーなら `nstandard.info@gmail.com` だが、別カレンダーを共有した場合は `xxxx@group.calendar.google.com` のような不透明な ID になる。**この実値が members.js に入る**ので必ず実物を確認する。 | 田中さん | Google カレンダー設定 → 該当カレンダー → 「カレンダーの統合」内の「カレンダー ID」 |
| 4 | **Google Cloud プロジェクトと OAuth クライアント（Webアプリ）の作成**。Google Calendar API を有効化し、OAuth 2.0 クライアント ID（種別: ウェブアプリケーション）を発行。**「承認済みの JavaScript 生成元」に本番 URL（GitHub Pages のオリジン）と開発用 `http://localhost:5173` を登録**。クライアント ID は秘密情報ではないが、登録オリジンと一致しないとトークン取得が失敗する。 | 田中さん | Google Cloud Console |
| 5 | **OAuth 同意画面の設定**。スコープに `.../auth/calendar.events` を追加。利用者が運用者 1 人なら、同意画面を「テスト」公開のまま**テストユーザーに運用者アカウントを登録**すれば審査不要で使える（推奨）。 | 田中さん | Google Cloud Console → OAuth 同意画面 |
| 6 | （本番で第三者に広く使わせる場合のみ）**Google の OAuth 審査（verification）**。`calendar.events` は機密スコープ扱いで、テストユーザー以外に配る場合は審査が必要。**今回は運用者 1 人運用なのでテストユーザー登録で回避可能**＝審査は不要の想定。広げる予定が出たら別途審査を申請する。 | 田中さん | Google Cloud Console |
| 7 | **reCAPTCHA v3 サイトキーの発行**（Firestore の App Check 用、後述）。低トラフィックの社内ツールなので Enterprise ではなく **v3（無料枠）**を選ぶ。本番オリジンをドメイン許可リストに登録。 | 田中さん | Google Cloud Console（reCAPTCHA）/ Firebase Console |
| 8 | **Firebase サービスアカウント JSON の発行**（後述の CI 書き込み移行用）。GitHub Secret に登録する。 | 田中さん | Firebase Console → プロジェクト設定 → サービスアカウント |

---

## 3. データモデル変更

### メンバー定義（`src/data/members.js`）

現状の瀬戸さん（`members.js:14`）:
```js
{ id: 'seto_r', ..., email: 'nstandard.info@gmail.com', ..., skipOutlookSync: true }
```

変更後:
- **瀬戸さん**: `calendarProvider: 'google'` と `googleCalendarId: '<事前準備#3で確認した実値>'` を追加。`skipOutlookSync: true` は**残す**（Graph には絶対触らない、の意味）。
- **その他 9 名**: `calendarProvider: 'outlook'` を明示（または「未指定なら outlook 扱い」とコードで吸収）。

```js
// 瀬戸さん
{ id: 'seto_r', nameJa: '瀬戸', email: 'nstandard.info@gmail.com',
  color: '#14B8A6', role: 'regular',
  skipOutlookSync: true,            // Graph には絶対書き込まない（維持）
  calendarProvider: 'google',       // 振り分け: Google 経路へ
  googleCalendarId: 'nstandard.info@gmail.com' }, // ※事前準備#3の実値に置き換える
```

> **要注意（既存のワナ）**: `graphCalendarService.js:15` の `MEMBER_EMAIL_MAP` に `'ryota.seto@altenergy.co.jp' -> 'seto_r'` という**別の会社アドレス**が残っている。これは Google 化された瀬戸さんには**死んだエントリ**。Google イベントの突合はこのマップに頼らず、`memberEmail` を `members.js` の Gmail（`nstandard.info@gmail.com`）に**直接ハードセット**する。混乱防止のためこの map エントリは削除を検討（→確認事項）。

### 割当レコード（assignment）

| フィールド | 型 | 説明 |
|---|---|---|
| `googleEventId`（新規） | string \| null | `outlookEventId` と並ぶフィールド。Google イベント ID を保持。作成時にセット、編集時の「ID 欠落なら作り直し」分岐で更新、ペースト時に null クリア。**`outlookEventId` と同一割当に両方セットしないこと**（突合 Map が ID 1 本前提）。 |
| `calendarProvider`（任意・推奨） | 'google' \| 'outlook' \| null | 突合エフェクトと書き込みが「どっちの ID を見るか」を判定しやすくする。なくても `googleEventId` の有無で代替可能だが、明示推奨。 |

> AppContext のリデューサ（`AppContext.jsx:154-162, 175-183`）は**ペイロードを丸ごとスプレッド**して保存するため、`googleEventId` は**自動で localStorage / Firestore に永続化**される。リデューサ側の変更は不要。呼び出し側でセット/クリアするだけ。

### 設定・環境

- localStorage 新キー: `construction-schedule-google-client-id`（Google OAuth クライアント ID。msalService の `STORAGE_KEYS` と同形）。GIS トークン自体は**メモリ内キャッシュのみ**（約1時間・サイレント更新するため localStorage に置かない）。
- 環境変数: `VITE_FIREBASE_APPCHECK_SITE_KEY`（reCAPTCHA サイトキー、公開して安全）を `.env` / `.env.example` / `deploy.yml` のビルド環境に追加。
- 新 Firestore コレクション `om-schedule-google-events`（Google 機能で使う場合）はルールに**最初から**追加する（後述のデフォルト全拒否に飲まれないように）。

---

## 4. 実装ステップ（フェーズ分け）

各フェーズは独立して動作確認できる順に並べています。**フェーズ①→②→③→④の順**で進めるのが安全（認証なしに読み書きは試せない／ルール本番化は最後）。

### フェーズ① Google 認証（GIS トークン）

MSAL を一切触らず、横に並列の Google 認証を追加します。

**新規ファイル**
- `index.html`: `<head>` 内、アプリ本体 `<script type="module">` の**前**に GIS スクリプトを追加。
  ```html
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  ```
  GIS は npm バンドルではなくグローバル `<script>` で `window.google.accounts.oauth2` を生やす。`async` なので**読み込み完了待ちの promise**が必須。
- `src/services/googleAuthService.js`: `msalService.js` と同じ形で GIS をラップ。
  - `loadGisScript()`: `window.google?.accounts?.oauth2` が出るまで待つ readiness promise。
  - `initGoogleTokenClient(clientId, callback)`: `initTokenClient` ラッパ。スコープ `https://www.googleapis.com/auth/calendar.events`。
  - `requestGoogleToken({prompt})`: 初回は `prompt:'consent'`、以降サイレントは `prompt:''`。
  - `getCachedGoogleToken()`: `expires_at = now + expires_in*1000` を記録し、**残り5分未満なら**サイレント再取得、十分なら現トークンを返す。
  - `revokeGoogleToken()`: GIS には MSAL のような logoutRedirect がないので `google.accounts.oauth2.revoke(token)` ＋ キャッシュ消去で代用。
  - `loadGoogleConfig/saveGoogleConfig` ＋ `DEFAULT_GOOGLE_CONFIG.clientId`。
- `src/context/GoogleAuthContext.jsx`: `AuthContext` と**完全に別**のプロバイダ。`useGoogleAuth()` で `isGoogleAuthenticated`、`googleLogin()`、`googleLogout()`、`getGoogleToken()`（非同期・文字列トークンを返す。コールバックを promise でくるんで `getToken()` と同じ使い心地にする）を公開。
  - **@altenergy.co.jp のドメインゲートは適用しない**（GIS は MSAL の `account.username` 相当を返さない。運用者の正当性はトークンのスコープに暗黙的に乗る）。

**変更ファイル**
- `src/App.jsx:398-404`: `<AuthProvider>` の中に `<GoogleAuthProvider>` を入れる。配置は **`AuthenticatedApp` の内側**を推奨（MSAL ログイン後にだけ Google を意味づける／未ログイン訪問者に GIS を走らせない）。**Google ログインはアプリ入場ゲートにしない**（MSAL が主ゲートのまま）。
- `src/components/layout/Header.jsx:225-270`: Outlook 操作群の隣に Google 用 UI を追加。未ログイン時「Googleログイン」（`googleLogin`）、ログイン時「Google同期」「ステータスドット」「Googleログアウト」。既存の className パターン（`border-accent/40` 等）を踏襲しつつ、MSAL クラスタと**見た目で明確に分ける**（運用者が 2 つの ID を混同しないように）。

**動作確認**: Header から Google ログインできてトークンが取れること（この時点では読み書きはまだ）。

### フェーズ② 読み取り＋突合（Google → 画面）

**新規/変更ファイル**
- `src/services/googleCalendarService.js`（読み取り部）:
  - `transformGoogleEvent(gEvent)`: **既存の内部イベント形 `{ id, memberKey, memberEmail, title, start, end, isAllDay, isBusy, location, organizerName, organizerEmail, attendees }` と完全同一のキー**を返す。`memberKey:'seto_r'`、`memberEmail:'nstandard.info@gmail.com'` を**ハードセット**（運用者アドレスでも会社アドレスでもない）。`title=gEvent.summary`、`isAllDay=Boolean(gEvent.start.date)`、`isBusy=gEvent.transparency!=='transparent'`。
  - **タイムゾーン正規化が最重要**: 既存 Outlook は `Prefer: outlook.timezone="Asia/Tokyo"`（`graphCalendarService.js:29`）のおかげで `start` が**オフセットなしの裸ローカル ISO**（`YYYY-MM-DDTHH:mm:ss`）で来る。App.jsx などが `.substring(0,10)`・`.substring(11,16)` で日付/時刻を切り出すため、Google の `start.dateTime`（`+09:00` 付き RFC3339）は**オフセットを剥がして JST 壁時計の裸 ISO に変換**する。剥がし忘れると時刻がずれる/切り出しが壊れる。
  - `fetchSetoCalendarEvents(googleAccessToken, startDate, endDate)`: `GET .../calendars/{encodeURIComponent(calendarId)}/events?timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime&timeZone=Asia/Tokyo`。`timeMin/timeMax` は `+09:00` 付き RFC3339。`nextPageToken` でページング（`@odata.nextLink` の Google 版）。`singleEvents=true` 必須（繰り返し予定を実体に展開＝Outlook の calendarView と同挙動）。戻り値は `{success, data, error}` で Graph と同形。
- `src/context/CalendarContext.jsx`: **`mergeEventsForProvider(newEvents, startDate, endDate, predicate)` を新設**。既存 `mergeEvents`（`:68-78`）は**プロバイダ非依存で範囲内を丸ごと置換**するため、そのまま Google に使うと**同じ日付範囲の Outlook イベントを消してしまう**。新メソッドは述語（例 `memberKey==='seto_r'`）に一致するイベントだけ範囲内で差し替える。`getEventsForMember`（`:88-95`）と `WeeklyView` のキーイング（`e.memberEmail===member.email`）は **`memberEmail` を Gmail に正しくセットすれば変更不要**。
- `src/hooks/useCalendarSync.js`: `syncFromGoogle(googleAccessToken, startDate, endDate)` を追加。`syncInProgressRef` を**再利用**（Google と Outlook が同時に走らないように）。`fetchSetoCalendarEvents` → `mergeEventsForProvider`（seto_r スコープ）。`setSyncStatus` 配線は流用。
- `src/components/layout/Header.jsx:39-64`: `handleGoogleSync()` を追加。`getGoogleToken()` で Google トークンを取り、`calendarProvider==='google'` のメンバーに対して `syncFromGoogle` を呼ぶ。既存 `handleSync`（Outlook）はそのまま、メンバーフィルタを「outlook 経路のメンバー」に絞る。
- `src/App.jsx:48-77`: **2 本目の突合 useEffect**（または既存を拡張）を追加。`a.googleEventId` が真の割当について、`events` を `id` で引いた同じ Map から `title`→`opportunityName/title`、`start.substring(0,10)`→`date`、`start.substring(11,16)`→`startTime`、`end.substring(11,16)`→`endTime`、`location`→`address` を `UPDATE_ASSIGNMENT`。**Graph ID と Google ID は衝突しない**ので eventById Map は 1 本で共用可、割当がどちらの ID フィールドを持つかで分岐するだけ。**依存配列は `[events, dispatch]` のみ＋`assignmentsRef` パターンを維持**（Firestore 書き込み嵐の既存対策を壊さない）。

> **二重表示の注意**: `WeeklyView` の `linkedOutlookIds`（`:154-160`）は割当と紐づくイベントを重複排除している。Google 紐づき割当は `googleEventId` を使うので、この Set に **`a.googleEventId` も追加**しないと、瀬戸さんのイベントが「Google イベント」と「割当」の二重で出る。

**動作確認**: 瀬戸カレンダーに直接入れた予定が Google 同期で画面に出ること、彼の列（`memberEmail` キー）に正しく並ぶこと、Outlook イベントが消えないこと。

### フェーズ③ 書き込み（画面 → Google：作成・更新・削除）

ここが最も分岐箇所が多い。**振り分けを 1 箇所に集約**して各呼び出し側のコピペを防ぐ。

**新規ファイル**
- `src/services/googleCalendarService.js`（書き込み部）: `graphCalendarService` と**同じ `{success, data, error}` 契約（`data.id` あり）**で
  - `insertCalendarEvent(token, calendarId, eventBody)` → `POST .../calendars/{ENC(calendarId)}/events`
  - `patchCalendarEvent(token, calendarId, eventId, eventBody)` → `PATCH .../events/{eventId}`
  - `removeCalendarEvent(token, calendarId, eventId)` → `DELETE .../events/{eventId}`。**404/410 は `{alreadyGone:true}` 扱い**（Graph の `graphDelete` と同じ）。
  - `buildGoogleEventBody(eventData)`: アプリ内の MS365 形 `eventData` を Google 形に**1 箇所で変換**。`summary`（←subject）、`description`（←body.content）、`location` は**ただの文字列**（←location.displayName）。時刻あり: `start/end {dateTime:'YYYY-MM-DDTHH:MM:SS', timeZone:'Asia/Tokyo'}`。**終日: `start/end {date:'YYYY-MM-DD'}` かつ Google の終日 `end.date` は翌日（排他的）** ←ここが既存 Outlook と決定的に違う。
- `src/services/calendarWriteRouter.js`（または context からの helper）: **全呼び出し箇所が使う唯一の振り分け器**。メンバーを渡すと `{provider, write:{create,update,delete}, addressKey(email|calendarId), idField('outlookEventId'|'googleEventId'), getToken}` を返す。`calendarProvider` 分岐をここに閉じ込め、`AssignModal`/`QuickAddModal`/`EventDetailModal`/`App` が各自で if/else を書かないようにする。Outlook 側は `skipOutlookSync` セマンティクスを維持。

**変更ファイル**（すべて router 経由に寄せる）
- `src/components/schedule/AssignModal.jsx:109-167`: `!member.skipOutlookSync` の Outlook 限定分岐を**プロバイダ分岐**に置換。`google` なら GIS トークン→`insert`→戻り ID を**新フィールド `googleEventId`** に、`outlookEventId:null` のまま。それ以外は従来通り。`syncOutlook` チェックボックスは**両プロバイダ共通の単一ゲート**のまま。「先にリモート作成→ID を保存」の順序は維持。
- `src/components/schedule/QuickAddModal.jsx:86-138`: AssignModal と同じ分岐。`googleEventId` をペイロード（`:135`）に追加。router を再利用（3 度目のコピペを避ける）。
- `src/components/schedule/EventDetailModal.jsx:296-463`: **最も重い**。3 つの手動ループ（残留=patch/欠落なら insert、追加=insert、削除=remove）＋削除ハンドラの**各所**で `member.calendarProvider` 分岐。瀬戸さんは ID に **`googleEventId`**、宛先に **`calendarId`** を使う。「ID 欠落なら作り直し」フォールバック（`:308-316`）は**そのプロバイダ自身の ID フィールド**を見る。生成 ID は `UPDATE_ASSIGNMENT` でプロバイダ対応フィールドに入れる。pure-Outlook 分岐（`:368`）は割当でないイベント専用なので Outlook のまま据え置き可。
- `src/App.jsx:239-266`: Delete キーのバックグラウンド削除ループをプロバイダ分岐。瀬戸さんは `google remove(token, calendarId, t.googleEventId)`。`App.jsx:6` は `deleteCalendarEvent` しか import していないので **Google delete を import 追加**。`AppInner` は `useAuth` のみ消費（`:39`）なので **`useGoogleAuth` も追加**。
- `src/App.jsx:142-159`（pasteAt）: ペースト時に `googleEventId:null` も**リセット**（既に `outlookEventId:null`・`groupId:null` をリセット済み）。ペーストはどちらのプロバイダでもリモート書き込みしない＝未同期下書きから始める。

**エラー集約**: 既存の `outlookResults`/`outlookErrors` を **`syncErrors` に一般化**。GIS トークンが期限切れ（受容済みカフェアット）で Google だけ失敗、Outlook は成功、というケースを**メンバー単位で**集計・通知する。

> **DailyView/WeeklyView のドラッグ移動・リサイズ**（`DailyView.jsx:194-207,237-240`／`WeeklyView.jsx:356-364,383-390`）は**現状ローカル `UPDATE_ASSIGNMENT` のみ**でリモート書き込みしていない（Outlook にも飛ばしていない）。**パリティ上は変更不要**＝瀬戸さんが不利になることはない。「ドラッグでも即 Google 反映したい」なら**両プロバイダ同時に**新規書き込み配線が必要（現スコープ外、→確認事項）。

**動作確認**: 瀬戸さんに割当作成→彼の Google カレンダーに入る→編集→反映→削除→消える。Outlook メンバーが従来通り動く。瀬戸＋Outlook 混在グループでループが両方走る。

### フェーズ④ Firestore ルール本番化

詳細は §5。コードのデプロイ（auth 待ち合わせ）と CI 書き込みの Admin SDK 移行を**先に**入れ、最後にルールを締める順序を厳守。

---

## 5. Firestore ルール本番化の具体案

### 大前提（必ず理解しておく）
- このアプリは **MSAL/Azure AD でログイン**しており、**Firebase Auth は使っていない**。よって **Firestore ルールから MSAL のユーザー ID は一切見えない**（`request.auth` は常に `null`）。`AuthContext` の `@altenergy.co.jp` ドメインゲート（`:17-22`）も **UI 層だけ**でルールには届かない。
- アプリは GitHub Pages の静的 SPA、**リポジトリは公開**。Firebase 設定はバンドルに埋め込まれて誰でも読める。つまり**今のテストモード（全世界読み取り可）では、設定さえ拾えば誰でも SF 顧客データ（`om-schedule-sf-data`）や割当を直接読める**。これが現実の穴。

### 推奨方式: 匿名認証（Anonymous Auth）＋ App Check ＋ ロックルール（オプション c）

正直に言うと、これは「完璧な認可」ではなく**多層防御／不正アクセス低減**です。匿名認証だけなら公開設定で誰でも `request.auth!=null` を満たせるので単体では境界になりません。App Check（reCAPTCHA v3）が「登録済みアプリ/ドメインからのリクエストか」を検証して**casual な『設定を拾って curl』を塞ぎます**。ただし v3 は本気の攻撃者（トークン再生・ヘッドレス農場）には破られ得るし、どちらも**「利用者が @altenergy.co.jp か」は証明しません**。社内ツールのリスクに対しては妥当な落としどころです。完全なドメイン強制は唯一オプション d（Cloud Function で MSAL の id_token を検証し Firebase カスタムトークンを発行）でのみ可能ですが、「サーバーレス」設計に反するため**今回は対象外・将来のハードニング**として記録します。

### `firebase.js` の改修（`src/firebase.js:1-24`）
唯一の初期化点なのでここに App Check と匿名サインインを足す。
```js
// initializeApp(app) の直後・getFirestore の前に App Check
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
// 匿名サインイン → 完了 promise を export（呼び出し側が await する）
import { getAuth, signInAnonymously } from 'firebase/auth';
export const firebaseAuthReady = signInAnonymously(getAuth(app));
```
既存の `try/catch` ＋ `projectId` ガードは維持（設定欠落でも no-op）。

### 読み書き呼び出しを「匿名サインイン完了後」に待ち合わせ
ロック後、サインイン完了前に走る read/write は permission-denied になる。下記を `firebaseAuthReady` を `await` する形に。
- `src/services/firestoreService.js:28-127`（`saveAssignments`/`load*`/`subscribe*`）: `isFirestoreEnabled()` に `auth.currentUser` 必須を足すか、各入口で promise を待つ。ドキュメントパス（`'shared'` 単一ドキュメント）の形は変えない。
- `src/context/AppContext.jsx:335`（マウント時 `subscribeAssignments`）と `:21`（800ms デバウンス書き込み）: 既存の `initialLoadDoneRef`（「初回ロード前は書かない」ガード）と**同じ場所で auth 完了も待つ**。
- `src/services/sfDataService.js:37-56`（`subscribeSfData`、最高機密の顧客データ）: 購読開始を auth 完了に gate。

### CI 書き込みの Admin SDK 移行（**ルールを締める前に必須**）
- `scripts/sync-sf.mjs:44-51,244-281`: 現在は**クライアント SDK ＋ 公開 config で未認証クライアントとして** `om-schedule-sf-data` を書いている。ルールを締めると**この `batch.commit()` が失敗してSF同期が止まる**。**`firebase-admin`（サービスアカウント）に移行**するとルールを完全バイパスできる（GitHub Actions では App Check を通すのが困難なため Admin SDK が正解）。
- `.github/workflows/sync-sf.yml:42-49`: `FIREBASE_SERVICE_ACCOUNT`（または `GOOGLE_APPLICATION_CREDENTIALS`）Secret を追加。これで SF データのルールを**クライアント書き込み全面禁止**にできる。
- `.github/workflows/deploy.yml:32-38`: `VITE_FIREBASE_APPCHECK_SITE_KEY` をビルド環境に追加。

### ルールファイル（リポジトリに新規作成・現状はコンソールにしか無い）
- `firestore.rules`（リポジトリ直下・新規）:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function ok() { return request.auth != null; }   // 匿名サインイン済みか
    match /om-schedule-assignments/{id}     { allow read, write: if ok(); }
    match /om-schedule-filter-presets/{id}  { allow read, write: if ok(); }
    match /om-schedule-sf-data/{id}         { allow read: if ok(); allow write: if false; } // 書き込みは Admin のみ
    match /om-schedule-google-events/{id}   { allow read, write: if ok(); }                 // 新コレクション(使う場合)
    match /{document=**}                     { allow read, write: if false; }               // 既定で全拒否
  }
}
```
- `firebase.json`（リポジトリ直下・新規）: `{ "firestore": { "rules": "firestore.rules" } }`。コンソール手編集ではなく `firebase deploy --only firestore:rules` でバージョン管理＆デプロイ。

### コンソール設定（ルール文には書けない部分）
- **App Check のenforcementは Firebase Console のプロダクト別トグル**で、ルール文には現れない。**いきなり enforce にすると、App Check トークンを送れていない既存クライアントの read/write が全滅**する。**まず「monitor（監視）」モードで様子を見て**、本番クライアントが App Check トークンを送れていることを確認してから enforce に切り替える。
- reCAPTCHA キーと App Check アプリは**正しいプロジェクト**（projectId は `om-schedule` 想定、Firestore リージョン `asia-northeast1` 想定）に登録。本番オリジン（github.io ＋ カスタムドメインがあればそれ）をドメイン許可リストに正確に入れる。ミスマッチは**無言で全 attestation 失敗**になる。

### 移行順序（ダウンタイム防止）
1. `firebase.js` に匿名サインイン＋App Check（monitor モード）を入れ、各 read/write を `firebaseAuthReady` 待ちに改修してデプロイ。
2. `sync-sf.mjs` を Admin SDK に移行、Secret 追加。
3. App Check の状況を monitor で確認 → enforce に切替。
4. **最後に** `firestore.rules` を本番ルールに切替（テストモード解除）。

---

## 6. リスク・ハマりどころ

既存の「ハマりどころ集」の作法に合わせて、今回該当するものを列挙します。

- **【終日イベントの形が Outlook と違う】** 既存 Outlook の終日は `start==end`（`AssignModal.jsx:127-128` で確認済み）。これを Google にそのままコピーすると**長さ 0／不正な終日イベント**になる。Google は `start.date` ＋ **排他的な翌日 `end.date`** が必須。`buildGoogleEventBody` で**必ず特別扱い**する。読み取り側の `getAllDayEventsForMemberDate`（`WeeklyView.jsx:185` の `dateStr>=start && dateStr<end`）は排他的 end と整合するので、`transformGoogleEvent` の end をそれに合わせる。

- **【filter/キーイングのワナ】** Google イベントの `memberEmail` を**会社アドレスや運用者アドレスにすると瀬戸さんの列に出ない**（`getEventsForMember` / `WeeklyView` は `member.email`＝Gmail でフィルタするため）。必ず `nstandard.info@gmail.com` をハードセット。`MEMBER_EMAIL_MAP` の `ryota.seto@...` は死にエントリなので頼らない。

- **【merge の全消し】** `mergeEvents`（`CalendarContext.jsx:68-78`）はプロバイダ非依存で範囲を丸ごと置換。Google にそのまま使うと**同窓の Outlook イベントを消す（逆も）**。`mergeEventsForProvider` を必ず使う。

- **【二重表示（dedup）】** `WeeklyView.linkedOutlookIds`（`:154-160`）に **`a.googleEventId` を足さない**と瀬戸さんの予定が二重に出る。

- **【EventDetailModal の ID 取り違え】** 同ファイルは `a.outlookEventId` を約 6 箇所（残留/追加/削除/Delete）で使う。**1 箇所でも分岐を入れ忘れると**瀬戸さんの編集/削除が「間違った API に間違った ID」で空振りし、Google イベントが孤児化する。被害範囲が大きいので**必ず `calendarWriteRouter` に集約**してドリフトを防ぐ。

- **【ハンドラ内でトークンソースが 2 つ】** 今まで MSAL トークンだけ取っていたハンドラが、バッチに Google メンバーがいると **GIS トークンも取得**する必要がある。GIS が途中で失敗/期限切れだと Google 書き込みだけ落ちて Outlook は成功する → **メンバー単位のエラー集約（`syncErrors`）**で部分失敗を可視化。

- **【GIS トークン更新 UX（受容済みカフェアット）】** GIS のブラウザトークンは約 1 時間で、サイレント更新は**アクティブな Google セッション内でのみ**動く。MSAL の `acquireTokenSilent→redirect` のような堅牢なフォールバックは**ない**。`getGoogleToken()` はサイレント失敗時に `null` を返し、Header に「再ログイン」導線を出す（`Header.jsx:43` の MSAL トークン null 時アラートと同じ作法）。読み取り（`fetchSetoCalendarEvents`）もページング中に 401 し得るので、`graphGet` の非 ok 分岐と同様に拾って再認証を促す。

- **【GIS スクリプトが async】** `index.html` の `<script async>` のため、`initTokenClient` を `window.google.accounts.oauth2` 生成前に呼ぶと throw する。`googleAuthService` の readiness promise を**必ず待ってから**トークン要求する。`GoogleAuthProvider` はマウント時にスクリプト読込済みを前提にしない。

- **【ID 双方セット禁止】** 突合の eventById Map は割当 1 件に ID 1 本前提。**同一割当に `outlookEventId` と `googleEventId` を両方セットしない**こと。

- **【Tailwind 4 の @layer/カスケード】** このプロジェクトは **Tailwind 4（`@import "tailwindcss"` ＋ `@theme inline`、CSS ファースト構成）**。Header に Google 用ボタン群を追加するとき、**unlayered な独自 CSS はユーティリティに勝つ**（src の CSS コメントにも明記あり）ため、`@layer components` を外れた素の CSS で上書きすると意図せず Tailwind ユーティリティを潰す。新ボタンは**既存ボタンの className（`border-accent/40`, `text-accent`, disabled/syncing 状態）を踏襲**し、独自 unlayered CSS を増やさない。

- **【二重ガードの腐敗リスク】** 瀬戸さんに `skipOutlookSync:true` と `calendarProvider:'google'` を**両方残す**のは正しいが、将来「掃除」で `skipOutlookSync` を消すと Graph 書き込みが彼の Gmail に復活し 404/失敗する。`members.js` の彼の定義に**二重の意味をコメントで明記**する。あるいは「outlook-skip を `calendarProvider!=='outlook'` から導出」して単一フラグ化する案も検討（→確認事項）。

- **【ルールを締めると CI と初回読み書きが即死】** `sync-sf.mjs`（未認証クライアント書き込み）と、匿名サインイン完了前に走る `AppContext` のマウント購読・`sfDataService` 購読が壊れる。**§5 の移行順序を厳守**（コード＋Admin 移行を先、ルール切替を最後）。

- **【テストモードの 30 日期限】** ドキュメントによるとテストモードルールは 30 日で失効する可能性。**既に失効していると今この瞬間アプリが落ちている**かもしれず、緊急度と順序が変わる。現在の期限を最初に確認（→確認事項）。

---

## 7. 工数感とおすすめの着手順

ざっくりの目安（1 人・既存コード理解済み前提。事前準備の待ち時間は除く）。

| フェーズ | 内容 | 目安 |
|---|---|---|
| 事前準備 | Google Cloud / OAuth / 共有設定 / 各種キー | 0.5〜1 日（瀬戸さん・運用者の作業待ち含むと前後する） |
| ① Google 認証 | `googleAuthService` ＋ `GoogleAuthContext` ＋ Header ボタン ＋ index.html | 1〜1.5 日 |
| ② 読み取り＋突合 | `googleCalendarService`(read) ＋ `mergeEventsForProvider` ＋ `syncFromGoogle` ＋ 2 本目の突合 effect ＋ dedup | 1.5〜2 日（TZ 正規化と merge スコープが地雷） |
| ③ 書き込み | `googleCalendarService`(write) ＋ `calendarWriteRouter` ＋ 4 呼び出し箇所改修（EventDetailModal が重い） | 2〜3 日 |
| ④ Firestore ルール本番化 | `firebase.js` 改修 ＋ auth 待ち合わせ ＋ `sync-sf.mjs` Admin 移行 ＋ rules/firebase.json ＋ コンソール設定 | 1.5〜2 日 |

**合計の目安: 実装で約 7〜10 営業日**＋事前準備とテスト。

**おすすめ着手順**:
1. **まず事前準備（§2）を全部終わらせる**。特に #3 の calendarId 実値が無いと②③が書けない。
2. **フェーズ④の準備だけ先行で着手しても良い**（テストモード失効のリスクがあるため）。ただし**ルール切替は最後**。`firebase.js` の匿名認証＋App Check（monitor）と `sync-sf.mjs` の Admin 移行は早めに入れて検証しておく。
3. その後 **①→②→③** の順。①が無いと②③は実機確認不能。
4. ③は **`calendarWriteRouter` を先に作ってから**各呼び出し箇所を寄せる（コピペと取り違えを防ぐ）。`EventDetailModal` は最後に回す（分岐が最多）。
5. 各フェーズ末で**瀬戸さん実カレンダーでの往復確認**を必ず行う（作成→Google で見える→編集→反映→削除→消える）。

---

## 8. 未確定の確認事項（着手前にユーザーへ）

1. **瀬戸カレンダーの正確な calendarId**: 運用者アカウントから見て `nstandard.info@gmail.com`（メインカレンダー）か、`xxxx@group.calendar.google.com`（別カレンダーを共有した場合）か。**実物の確認が必要**（`list_calendars` 等）。`members.js` の `googleCalendarId` がこれに依存。
2. **チェックボックス文言**: 1 つのフラグ（`syncOutlook`）で両プロバイダを駆動するので、ラベルを「Outlookに登録する」のままにするか、プロバイダ中立の「**カレンダーに登録**」に変えるか（`AssignModal.jsx:396-398`, `QuickAddModal.jsx:262`, `EventDetailModal.jsx:707-709`）。機能は同一、UX 文言のみ。
3. **ドラッグ移動/リサイズを Google にライブ反映するか**: 現状は Outlook も含め**ローカルのみ**でリモート未送信。瀬戸さんがドラッグ即反映を期待するなら、**両プロバイダ同時に**新規書き込み配線が要る（現スコープ外）。やるか?
4. **`skipOutlookSync` を将来削除するか**: `calendarProvider` 導入後、`skipOutlookSync` を `calendarProvider!=='outlook'` から導出して**単一フラグ化**するか、後方互換で残すか。二重ガード腐敗リスク回避のためには単一化が安全。
5. **`MEMBER_EMAIL_MAP` の `ryota.seto@altenergy.co.jp` 行を削除するか**（`graphCalendarService.js:15`）。瀬戸さんが Google 専用になり Gmail でキーイングされるため、この行は死にエントリで将来の混乱源。
6. **Google OAuth クライアント ID の置き場所**: `DEFAULT_GOOGLE_CONFIG` にハードコードするか、`SettingsView` に入力欄を作って永続化するか（Azure の clientId/tenantId 設定と同じ作法）。クライアント ID は秘密ではないが登録オリジンと一致必須。
7. **`GoogleAuthProvider` の配置**: 全ツリー（`AuthProvider` と並列）か、認証後サブツリー（`AuthenticatedApp` 内）か。**未ログイン訪問者に GIS を走らせない `AuthenticatedApp` 内を推奨**。
8. **Firebase 詳細の確認**: projectId（`om-schedule` 想定）、Firestore リージョン（`asia-northeast1` 想定）、本番オリジン（github.io ＋ カスタムドメインの有無）。reCAPTCHA/App Check のドメイン許可リストに正確に要る。
9. **CI 書き込みを Admin SDK に移行してよいか**: `sync-sf.mjs` に `firebase-admin` ＋ サービスアカウント GitHub Secret を追加する案。CI の認証情報モデルが変わるので**サインオフが必要**。これが嫌なら SF データのルールを緩める（非推奨）。
10. **`om-schedule-google-events` コレクションを使うか**: Google イベントをブラウザクライアントが書くだけか、CI も書くか。ルール（`write: if request.auth!=null` か Admin 例外も要るか）が変わる。
11. **テストモードルールの現在の失効日**: 既に切れているとアプリが既に落ちている可能性があり、緊急度・順序が変わる。
12. **将来 Cloud Function（オプション d）でドメイン強制まで行うか**: 「サーバーレス」設計（OMアプリ doc 行 42/252）に反する。やらないなら**ドメイン強制は UI 層止まりのまま**であることを受け入れる。


---

## 付録: ファイル参照（すべて絶対パス）

- `C:\dev\Claude_Code\58_construction-schedule\src\data\members.js`
- `C:\dev\Claude_Code\58_construction-schedule\src\firebase.js`
- `C:\dev\Claude_Code\58_construction-schedule\src\services\graphCalendarService.js`
- `C:\dev\Claude_Code\58_construction-schedule\src\services\googleCalendarService.js`（新規）
- `C:\dev\Claude_Code\58_construction-schedule\src\services\calendarWriteRouter.js`（新規）
- `C:\dev\Claude_Code\58_construction-schedule\src\services\googleAuthService.js`（新規）
- `C:\dev\Claude_Code\58_construction-schedule\src\context\GoogleAuthContext.jsx`（新規）
- `C:\dev\Claude_Code\58_construction-schedule\firestore.rules`（新規）
- `C:\dev\Claude_Code\58_construction-schedule\firebase.json`（新規）

検証済みの事実: members.js:14 の瀬戸定義（Gmail＋skipOutlookSync:true）／firebase.js は getFirestore のみで Auth・App Check なし／index.html head に第三者 SDK なし／AssignModal の終日は start==end の Outlook 形（:127-128）／graphCalendarService の MEMBER_EMAIL_MAP に死にエントリ `ryota.seto@altenergy.co.jp`／**Tailwind 4.2 系（`@import "tailwindcss"` + `@theme inline`）でカスケード注意は実在**／Firebase 12／firestore.rules・firebase.json はリポジトリに不在。