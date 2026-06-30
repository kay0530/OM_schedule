<!-- Google同期 + Firestore本番化 セットアップ手順書 (feat/google-calendar-sync) -->

# 瀬戸さん Googleカレンダー同期 ＋ Firestoreルール本番化 セットアップ手順

ブランチ `feat/google-calendar-sync` に **Phases 1〜4 のコードは実装済み**（main最新に追従・ビルド成功）。
あとは下記の **コンソール作業（あなた）** と **段階デプロイ（一緒に）** を順番にやれば本番化できます。

- 公開URL: https://kay0530.github.io/OM_schedule/
- GitHub: https://github.com/kay0530/OM_schedule
- Firebase project: `om-schedule`（Firestore リージョン asia-northeast1）

---

## Part A ─ カレンダー同期を動かす準備（瀬戸さん＋Google Cloud）

### A-1. 瀬戸さん：カレンダー共有（本人作業）
1. PCで Googleカレンダーを開く
2. 左「マイカレンダー」の自分の名前 → **⋮ →「設定と共有」**
3. 「**特定のユーザーやグループと共有**」→「ユーザーを追加」→ **あなた（田中さん）の会社Googleアカウントのメール**
4. 権限を「**予定の変更権限**」にして送信（※閲覧のみは不可）

### A-2. カレンダーIDの確認（田中さん）
1. あなたのGoogleに来た共有招待を承諾
2. 瀬戸さんのカレンダー設定 →「**カレンダーの統合**」→「**カレンダー ID**」を確認
3. 通常 `nstandard.info@gmail.com`。**違えば連携担当（Claude）に伝える** → `src/data/members.js` の `googleCalendarId` を修正

### A-3. Google Cloud：OAuthクライアント作成（田中さん）
1. https://console.cloud.google.com/ でプロジェクト作成（例 `OM-schedule`）
2. 「APIとサービス」→「ライブラリ」→ **Google Calendar API** を有効化
3. 「OAuth同意画面」：User Type=**外部** → アプリ名等入力 → スコープに **`.../auth/calendar.events`** を追加 → **テストユーザー**にあなたの会社Googleアカウントを追加（公開ステータスは「テスト」のままでOK）
4. 「認証情報」→「認証情報を作成」→「**OAuthクライアントID**」→ 種類=**ウェブアプリケーション** → 「承認済みのJavaScript生成元」に2つ：
   - `https://kay0530.github.io`
   - `http://localhost:5191`
5. 表示された **クライアントID（`〜.apps.googleusercontent.com`）** を控える
   → アプリの **設定 → Google連携（瀬戸さん）** に貼って保存（デプロイ後でOK）

---

## Part B ─ Firestoreルール本番化の準備（Firebase / GitHub）

> 目的：現在「テストモード（誰でも読める）」のFirestoreを締める。コードは安全側（鍵が無ければ無効・ルールは最後に手動）。

### B-1. reCAPTCHA v3 サイトキー（App Check用）
1. Firebase Console → プロジェクト `om-schedule` → **App Check**
2. アプリ（Web）を登録 → プロバイダ **reCAPTCHA v3** → サイトキー発行（ドメインに `kay0530.github.io` を登録）
3. **enforce はまだONにしない**（まず「monitor（監視）」のまま）
4. サイトキー（公開可）を控える

### B-2. 匿名認証を有効化
1. Firebase Console → **Authentication** → Sign-in method
2. **「匿名」を有効化**（これが無いとロック後にアプリが読めなくなる）

### B-3. サービスアカウント（SF同期のAdmin SDK用）
1. Firebase Console → プロジェクト設定 → **サービスアカウント** → 「新しい秘密鍵を生成」→ JSONダウンロード
2. このJSONは**秘密情報**。リポジトリに置かない

### B-4. GitHub Secrets 登録
GitHub → リポジトリ → Settings → Secrets and variables → Actions → New repository secret:
- `VITE_FIREBASE_APPCHECK_SITE_KEY` = B-1のサイトキー
- `FIREBASE_SERVICE_ACCOUNT` = B-3のJSONの中身（まるごと貼り付け）

---

## Part C ─ 段階デプロイ（順番厳守・Claudeと一緒に）

> ⚠️ 順番が命。**ルールのフリップは必ず最後**。途中で本番が止まらないようにする。

1. **`FIREBASE_SERVICE_ACCOUNT` シークレットを先に登録**（B-4）
   - これが無いと、Phase4をmainに入れた瞬間、30分ごとのSF同期が「鍵なし」で止まる
2. （任意・推奨）`VITE_FIREBASE_APPCHECK_SITE_KEY` 登録 ＋ App Check を **monitor** に ＋ 匿名認証ON（B-1/B-2/B-4）
3. **Phases 1〜4 を main にマージ → デプロイ**（Claude）
   - この時点では：Google機能はクライアントID設定までドーマント／App Checkはmonitor（非ブロック）／匿名認証は試行（失敗しても読める）／SF同期はAdmin SDKへ
4. **動作確認**：
   - アプリが普通に開く・割当が読める
   - SF同期（手動 or 次のcron）が成功（Admin SDK経由）
   - App Check の monitor で「トークンを送れているか」を確認
5. App Check を **enforce** に切替（Firebase Console）
6. **最後に** `firestore.rules` を本番反映（テストモード解除）：
   - 方法a: `firebase deploy --only firestore:rules`（要 Firebase CLIログイン）
   - 方法b: Firebase Console の Firestore ルール画面に `firestore.rules` の内容を貼って公開
7. **再確認**：割当の読み書き・SFデータ表示・フィルタ共有が今まで通り動く
8. **カレンダー同期テスト**（Part A完了後）：設定でGoogleクライアントID保存 → ヘッダー「Google連携」→「Google同期」で瀬戸さんの予定が出る → 割当を作成→彼のGoogleカレンダーに入る→編集/削除も反映

---

## 補足・既知の注意

- **完全な認可ではない**：このアプリはMSAL認証でFirebase Authを使わないため、ルールから「@altenergy.co.jpの人か」までは判定不可。匿名認証＋App Checkは「設定を拾ってcurl」を防ぐ多層防御。完全なドメイン強制はCloud Function（将来課題）。
- **Googleトークンの自動更新**はMSALより弱い（約1h、Googleセッション内で無音更新）。切れたら設定画面で再連携。
- **瀬戸さんは活動報告エクスポートの対象外**（Outlookのみ）。Google同期がmainに入れば将来含められる。
- ロールバック：問題が出たら `firestore.rules` をテストモードに戻す（Console）／App Checkを monitor に戻す、で即復旧。
