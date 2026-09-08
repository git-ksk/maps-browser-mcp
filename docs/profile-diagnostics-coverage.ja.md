# Cloud Runログイン引き継ぎ診断の範囲

原因切り分け用の診断であり、ログイン維持を成功させる変更ではない。復元フラグはHuman後のAgent A起動1回だけ。Human/Agent権限、candidateの保存・昇格条件は維持する。

## 観測経路と判断

| 境界 | 記録 | 判断できること |
| --- | --- | --- |
| Human revoke | `human_revoke_started/completed/failed`、surface有無 | revoke/closeが戻ったか。transportは既存Handoff診断と照合 |
| Human停止 | window close / SIGTERM / SIGKILL / quiescence | ウィンドウ閉鎖とプロセス終了の違い、強制終了、停止時のファイル変化 |
| profile | Cookie DB/WAL、session file数・容量・更新時刻、`metadataReadFailures` | sessionファイルの存在・変化。読み取り失敗を不存在と誤認しない |
| process | `processScanAvailable/processReadFailures`、種別集計 | 走査不能時は0件を停止の証明にしない |
| candidate stage | `profile_store_step:stage_candidate` | archive / structure / sqlite / pointer_read / upload / metadataの失敗地点 |
| Agent起動 | `sessionRestorePending/Requested`、`freshProcessSpawned`、runtime fingerprint | one-shot要求とspawn経路。CDP readyとは別 |
| CDP接続段階 | chrome_start / target_list / target_create / target_attach / domains_enable / cdp_ping | Chrome起動、一覧取得、新規ページ作成、接続、domain有効化、再利用時の生存確認を分離 |
| 接続タブ選択 | `agent_surface_diagnostics:targets` | Maps/認証/blank/その他のページ数、既存Maps/新規blank/曖昧/キャッシュの選択 |
| navigation | `step:navigate`、loadWait、navigationError、download | コマンド成否、load通知かタイムアウトか、エラー応答・ダウンロード化 |
| 現在ページ | surface/mainFrameSurface | Maps / 認証 / consent / challenge / Googleその他 / blank / browser error / その他 / 観測不能 |
| DOM状態 | readyState、visibility、language、body/controls/iframe数、可視control数 | 読み込み途上、非表示、要素未生成、隠れた要素の矛盾、言語の違い |
| readiness | probe.reason、summaryの理由別カウント | 下記9分類、最大12回の変化ログと最終probe詳細・全サンプル集計 |
| CDP評価 | exception/rejected/timeout、errorKind | ページ内例外、コマンド拒否、context消失、target切断、タイムアウト |
| ページ動作 | mainNavigations/contextClears/runtimeExceptions/crashes/disconnects | navigation、context再作成、JS例外・クラッシュ・切断の回数 |
| 通信 | document/script応答、HTTPエラー、redirect、loading失敗、main文書status | 読み込み不全。DNS/TLS/connection/timeout/aborted/blocked/otherの粗い分類 |
| 最終target | targetPresent/sameTarget、ページ数 | 選択targetの残存、ページ増減 |
| Agent停止・昇格 | checkpoint停止、`promote_candidate`のmetadata/pointer_read/pointer_write | 停止失敗と世代競合・pointer更新失敗を分離 |
| 保存後Agent | phase=`post_checkpoint`の同じ観測 | A成功と通常Agentの認証維持を分離 |
| cold-start復元 | profile_restore_succeeded/failed、source、digest、pointer世代、失敗stage | どの保存を復元したか、download/整合性・extractの失敗 |
| 通常readiness | phase=`ordinary_readiness` | 新instanceを含むreadinessの理由とページ分類。追加navigationなし |
| 診断自体 | observerAvailable/networkEnabled/crashObserverEnabled、observer:unavailable、cleanupState | 観測機能と解除結果。観測不能時の0件は成功の証明にならない |

## probeの9分類

`signed_in_controls`、`signed_out_controls`、`not_maps`、`missing_controls`、`conflicting_controls`、`invalid_probe`、`evaluation_exception`、`evaluation_rejected`、`evaluation_timeout`。

`missing_controls`は両control不在、`conflicting_controls`は両方検出、`invalid_probe`は戻り値なし・型不正・必要boolean不足。既存認証判定条件は変更しない。surface分類はhostも確認するが、Googleのセッション有効性を直接判定するものではない。

## 失敗時の読み順

1. revoke → quiescence → candidate stage → Agent connectの到達地点。
2. phase=`human_verification`の最後のstep、summaryのreason・理由別集計。
3. missingならreadyState/visibility/surface/通信/JS例外、conflictingなら可視control数と言語。
4. 評価エラーならcontext/target/切断/crash、ページ増減ならtarget inventory。
5. A成功時だけpost-checkpoint、新instance復元とordinary-readinessを照合。

step:startedだけが残る場合は未完了・強制終了・ログ欠落のいずれか。成功とは扱わない。step:completedは呼び出しが戻った意味であり、認証成功はphase結果とreadinessで別に判定する。post-checkpoint失敗時も既に昇格したpointerの自動rollbackはしない。

## 機密性・負荷・限界

- 新規Agent診断は固定enum・上限付き数値・booleanを型チェックして再構成。URL/path、target/frame/PID、DOM本文、アカウント、Cookie/token、request/response本文・header、例外本文、console本文はログに出さない。storeの生例外ログも固定分類へ置換。
- ページ内で既存アカウントcontrol条件を評価するが、資格情報input、Cookie値、storage値、認証DB行は読まない。
- Network観測はAとpost-checkpointのAgent接続後のみ。body取得、interception、追加fetch、タブ再試行、Human入力再生はしない。通常readinessではNetworkを有効化しない。
- readiness評価は1.5秒、診断target照会/Network有効化は1秒、解除は0.5秒で打ち切る。navigationコマンドは8秒、load待ちは従来の8秒、安定readiness待ちも従来の8秒。段階時間は累積するのでoperation timeoutも照合する。
- CDP観測失敗・ログ出力失敗で元の成功/エラーを置き換えない。評価/navigation自体のtimeoutは操作エラーとして閉じる。遅れて返った観測はログへ追記しない。
- 通信診断は接続targetで観測有効化後に届いたイベントのみ。起動前・他target・別process iframeの通信を網羅したtraceではない。lastDocumentStatusはmain frame IDが確認できた文書応答のみ。
- SQLite quick_checkは構造検査。Cookie残存・復号可能性・Google側有効性は証明しない。sessionファイルも内容を読まないため、復元可能なログインを含むかまでは分からない。
- Google側の失効、鍵の復号失敗、表示要素の仕様変更は、この情報だけで常に一意に確定できるとは限らない。追加調査の対象をそこまで限定する。即時kill・ログ欠落も含め「必ずすべて診断できる」という保証はしない。
