# Design Principles

この文書を PurpleMux の設計原則に関する唯一の正本とする。  
他の文書では個別機能や実装方法を説明してよいが、競合する設計原則を別途定義しない。

- **Terminal runtime.**  
  PurpleMux は、複数の Terminal と Coding Agent を継続的に利用するための runtime と操作面を提供する。Terminal の継続実行には tmux を利用する。

- **Runtime is the source of truth.**  
  tmux Session、process、Coding Agent など、実際の runtime が保持する状態を正本とする。PurpleMux 内にそれと競合する別の runtime state を作らない。

- **One concept, one authority.**  
  Resource identity、lifecycle、terminal state など、同じ概念について複数の独立した正本を持たない。Frontend、Server、永続データは、それぞれの責務に必要な状態だけを持つ。

- **Explicit ownership.**  
  PurpleMux が所有する resource と、外部で作成され PurpleMux が利用する resource を区別する。表示・入力・操作できることと、その resource の lifecycle を所有することを同一視しない。

- **Lifecycle follows ownership.**  
  Resource の生成、終了、復元、cleanup は ownership に従う。PurpleMux が所有しない resource を、UI 上の削除、登録解除、切断、再起動等を理由に暗黙に変更しない。

- **UI structure is not runtime structure.**  
  Workspace、Tab、Panel は PurpleMux 上の整理・操作モデルであり、runtime resource そのものとは限らない。UI の lifecycle と runtime resource の lifecycle を暗黙に結合しない。

- **Same semantics, same path.**  
  同じ意味を持つ terminal 操作や runtime behavior は、原則として同じ仕組みで扱う。入口や resource の由来が異なるだけで、独立した terminal runtime、状態管理、通信経路を増やさない。別経路を持つ場合は、責務または semantics の違いを理由とする。

- **Frontend is an interface, not an authority.**  
  Frontend は runtime を表示・操作するための層であり、runtime の存在、identity、ownership、lifecycle の正本を持たない。

- **Public contracts define external integration.**  
  AWM 等の外部システムは、PurpleMux が公開する CLI、API、URL 等を通して連携する。private file、Frontend 内部状態、非公開の実装詳細を正式な連携手段としない。

- **PurpleMux is not a workflow engine.**  
  タスク分解、実行順序、レビュー手順、再試行方針、複数 Agent の進行制御は PurpleMux の責務としない。それらは利用者または上位システムが担う。

- **Do not preserve unnecessary parallel mechanisms.**  
  同じ責務を既存の仕組みで表現できるなら、重複する runtime、状態管理、通信経路、永続化を並行して維持しない。役割を失った仕組みは削除する。
