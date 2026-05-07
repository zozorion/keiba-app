/**
 * 投稿種別の定義
 *
 * 旧来の「テンプレ文 + 変数置換」方式をやめ、
 * 「自由記述プロンプト + 必須要素 + 文字数目安」をLLMに渡す動的生成方式へ。
 *
 * 各 PostType は LLM への指示書であり、毎回違う切り口の文章が出るのを期待する。
 * テンプレ文ではなく "書き手への発注書" として読まれる。
 */

export interface PostType {
  id: string;
  label: string;
  category: 'x' | 'note';
  /** その種別固有の指示。状況分岐（曜日・時間帯）はここに書く */
  prompt: string;
  /** 本文に必ず含めたい事実キー（buildFacts のキーに対応） */
  requiredFacts: string[];
  /** 文字数の目安（X は 280 上限を意識） */
  lengthHint: string;
  /** ハッシュタグの目安（指示として LLM に渡す） */
  hashtagHint?: string;
}

export const POST_TYPES: Record<string, PostType> = {
  /* ============================== X 系 13種 ============================== */
  'x-preview': {
    id: 'x-preview',
    label: '🐦① 前日予告',
    category: 'x',
    prompt: `週末競馬の "前日予告" 投稿。明日の開催の概観と、自分が注目しているレースを匂わせる。
- 投稿時刻が金曜夜なら：平日仕事終わりのテンション。「平日終わった解放感」「酒を片手にデータ漁る週末ルーティンの始まり」みたいな入りが自然。
- 投稿時刻が土曜夜なら：「今日の土曜競馬を踏まえて明日の日曜開催を見ている」流れ。土曜の馬場傾向や手応えに触れてから、明日の話に繋げると自然。
- 開催場の数と注目レース TOP3 には必ず触れる。
- 軸馬の名前は出していい（"明日詳しく出す" 的に予告だけでもOK）。
- "テンプレっぽい締め" は避ける。前回・前々回の自分の投稿と似た書き出しと似たオチは絶対NG。`,
    requiredFacts: ['venues', 'venue_count', 'top3_races'],
    lengthHint: '180〜260字',
    hashtagHint: '#競馬予想 など最大3個',
  },

  'x-morning': {
    id: 'x-morning',
    label: '🐦② 朝イチ注目',
    category: 'x',
    prompt: `週末当日の "朝の注目レース紹介" 投稿。寝起きで一杯コーヒーやってる時間帯の感覚。
- 入りは短く、その日の朝のリアルな景色（天気、コーヒー、二日酔い、目覚めなど）を一行入れると自然。ただし毎回同じ表現はNG。
- 今日の BEST BET（一番自信あるレースと軸馬）と、他に何レース勝負どころがあるかを言う。
- 数字の根拠（種牡馬・枠・騎手データが噛み合ってる、など）に軽く触れていい。
- 「今日は忙しい」みたいな締めは可だが、毎回同じならず別の言い回しを使う。`,
    requiredFacts: ['date_label', 'venues', 'best_race', 'best_raceName', 'best_num', 'best_name', 'high_conf_count'],
    lengthHint: '180〜260字',
    hashtagHint: '#今日の競馬 #競馬予想 など最大3個',
  },

  'x-race': {
    id: 'x-race',
    label: '🐦③ 個別レース予想',
    category: 'x',
    prompt: `特定レースの軸馬予想投稿。レース直前〜1時間前くらいに出すイメージ。
- レース名・場・距離を冒頭で示す（事務的になりすぎないよう、自分の "そそられた理由" を一文で添える）。
- 軸馬の番号と名前、注目した理由（種牡馬適性・コース実績・展開・データの噛み合いなど）を 2〜3点。スコア数値（◯pt）は本文に書かない。
- ワイドの推奨買い目（軸→相手）を分かりやすく示す。
- 「数字は嘘つかない」「期待値プラスの時だけ勝負する」みたいな決めゼリフは "毎回違うフレーズで" 言う。同じ言い回しの繰り返しは絶対NG。`,
    requiredFacts: ['venue', 'raceNumber', 'raceName', 'surface', 'distance', 'pivot_num', 'pivot_name', 'pivot_reasons', 'wide_targets'],
    lengthHint: '200〜280字',
    hashtagHint: '#競馬予想 #{venue}競馬 など最大3個',
  },

  'x-graded': {
    id: 'x-graded',
    label: '🐦④ 重賞予想',
    category: 'x',
    prompt: `G1〜G3 の重賞用、力の入った最終結論投稿。
- 「昨日の夜から何時間もデータ回してた」「酒飲みながら出した結論」みたいな "本気度の伝わる入り" を入れる。ただし毎回同じ言い回しは避ける。
- 重賞名・グレード・場・コース距離を提示。
- ◎軸馬は番号・名前・推し理由（種牡馬・コース実績・データ的根拠）を厚めに。○▲も簡潔に。
- ワイド推奨買い目を示す。
- 締めは「人気と実力のズレ見つけた瞬間」「データが導いた答え」みたいな自分らしい一言、ただしテンプレ化しない。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance', 'pivot_num', 'pivot_name', 'pivot_reasons', 'second_num', 'second_name', 'third_num', 'third_name', 'wide_targets'],
    lengthHint: '230〜280字',
    hashtagHint: '#競馬予想 #{raceName} など最大3個',
  },

  'x-result': {
    id: 'x-result',
    label: '🐦⑤ 的中速報',
    category: 'x',
    prompt: `レース直後の結果報告投稿。的中時はテンション高め、外した時は淡々と・盛らずに。
- 軸馬が何着だったか、ワイドが取れたか取れなかったか、回収額を素直に書く。
- 的中時は「今夜はいい酒飲める」系の感情、外した時は「データ的にはこうだったけど展開が違った」みたいな冷静さ。
- 嘘つかない、盛らない。良い日も悪い日も同じ姿勢で晒す、というペルソナの根幹を体現する投稿。
- 「ハイボールの方がうまい」みたいな決めゼリフは毎回違う角度で。`,
    requiredFacts: ['venue', 'raceNumber', 'raceName', 'pivot_name', 'finish', 'hit_emoji', 'hit_detail'],
    lengthHint: '120〜200字',
    hashtagHint: '#競馬予想 #的中 もしくは #反省 など',
  },

  'x-daily': {
    id: 'x-daily',
    label: '🐦⑥ 日次まとめ',
    category: 'x',
    prompt: `その日の競馬全体の総括投稿。風呂入って一杯やる前の時間帯のイメージ。
- 軸馬3着内率、ワイドROI、会場別の的中状況を全部出す。良くても悪くても盛らない。
- "勝った時だけ報告するアカウントは信用できない" というペルソナの哲学が滲むように。
- AI への学習フィードバックの話題（「今日のデータも全部AIに食わせた」）は入れていい。ただし毎回同じ言い方はNG。
- 締めは「風呂入ってビール」「おつかれ」系で。これも毎回違う言い回しで。`,
    requiredFacts: ['date_label', 'venues', 'pivot_hits', 'total', 'pivot_rate', 'wide_roi', 'venue_breakdown'],
    lengthHint: '200〜280字',
    hashtagHint: '#競馬予想 #回収率 など最大3個',
  },

  'x-weekly': {
    id: 'x-weekly',
    label: '🐦⑦ 週間レポート',
    category: 'x',
    prompt: `月曜朝に出す週間総括投稿。
- 先週の分析レース数・軸馬3着内率・ワイドROI を提示。
- AI が毎週学習して精度が上がってきている話を入れていい（ただし毎週同じ言い方はNG）。
- "月〜金は仕事、金曜にAI回して、土日は馬券、月曜の朝に学習データ投入" の生活ループを語っていいが、毎週言うとくどいので、文脈に合わせて削る/別の角度から表現する。
- 「この生活ループたぶん一生続く」系の自虐は時々入れる程度に。`,
    requiredFacts: ['total_races', 'pivot_rate', 'wide_roi'],
    lengthHint: '230〜280字',
    hashtagHint: '#競馬予想 #AI予想 など最大3個',
  },

  'x-value': {
    id: 'x-value',
    label: '🐦⑧ 穴馬ピック',
    category: 'x',
    prompt: `中〜高オッズの注目馬ピック投稿。「人気と実力のズレ」を炙り出すのが本旨。
- 場・レース名から始めて、「これ多分みんなスルーしてる」系の入り。ただし毎回同じ言い回しはNG。
- 馬番・馬名・オッズ・種牡馬・推す理由を簡潔に。
- 「オッズが低い＝市場が来ないと判断、でもAIは走ると言ってる、その乖離が期待値」というロジックを毎回違う言葉で表現する。
- 投資感のある冷静な口調で。`,
    requiredFacts: ['venue', 'raceNumber', 'raceName', 'horse_num', 'horse_name', 'horse_odds', 'horse_sire', 'horse_reason'],
    lengthHint: '180〜260字',
    hashtagHint: '#穴馬 #競馬予想 など最大3個',
  },

  'x-course': {
    id: 'x-course',
    label: '🐦⑨ コース徹底解説',
    category: 'x',
    prompt: `特定コース（場×馬場×距離）のデータ解説投稿。週中（水曜あたり）にフォロワー向けに出すイメージ。
- 投稿のお役立ち感を出す。「使えそうなら使って」「置いとく」みたいなフォロワーへの距離感。
- 有力種牡馬・枠順傾向・脚質傾向を簡潔に。
- 「感覚と実際のデータがズレてること多い」みたいなペルソナの主張を毎回違う角度で。
- 派手な煽りはせず、淡々とデータを置く感じ。`,
    requiredFacts: ['venue', 'surface', 'distance', 'course_tips', 'top_sires', 'frame_summary', 'style_summary'],
    lengthHint: '200〜280字',
    hashtagHint: '#競馬データ #{venue}競馬 など最大3個',
  },

  'x-bias': {
    id: 'x-bias',
    label: '🐦⑩ 馬場傾向速報',
    category: 'x',
    prompt: `土曜の夜などに出す、その日の馬場傾向まとめ投稿。翌日の予想に使ってもらう前提。
- 内枠/外枠どちらが好走したか、脚質はどうだったかを数値ベースで端的に。
- 「前日の馬場データ意外と見られてないけど、これで馬券精度マジで変わる」系の主張を毎回違う言い方で。
- 「明日のこの場、これ頭に入れとくと損ない」系の締め。テンプレ化しない。`,
    requiredFacts: ['date_label', 'venue', 'bias_summary'],
    lengthHint: '180〜260字',
    hashtagHint: '#馬場傾向 #{venue}競馬 など最大3個',
  },

  'x-lifestyle-1': {
    id: 'x-lifestyle-1',
    label: '🐦⑪ 日常（仕事帰り）',
    category: 'x',
    prompt: `競馬と直接関係ない平日夜の日常投稿。仕事帰り、電車、コンビニ、酒、データ眺めてる時間。
- 競馬に直結する話題ではなく、ペルソナの生活感そのものを切り取る。
- 残業終わり/会社の人間関係/通勤の風景/部屋の散らかり/コンビニで買った酒、など。
- 軽くデータ・AIの話を匂わせる程度はOKだが、メインは "生活感のある一コマ"。
- 自虐と皮肉。決まり文句は使わず、毎回違う情景・違う角度で。`,
    requiredFacts: [],
    lengthHint: '140〜220字',
    hashtagHint: '#日常 #競馬好きと繋がりたい など最大2個（無くてもOK）',
  },

  'x-lifestyle-2': {
    id: 'x-lifestyle-2',
    label: '🐦⑫ 日常（週末の朝）',
    category: 'x',
    prompt: `週末の朝、競馬の日のリアルな朝の風景を描く投稿。
- 平日は寝坊するのに競馬の日だけ起きれる、コーヒー、AIの出力チェック、出走表にマーカー、みたいな具体的な情景。
- 静かで満ち足りた時間、孤独だけど好き、みたいな静かなトーン。
- 直接的な煽りや決めゼリフは控えめに。`,
    requiredFacts: [],
    lengthHint: '140〜220字',
    hashtagHint: '#競馬のある生活 など1個程度',
  },

  'x-lifestyle-3': {
    id: 'x-lifestyle-3',
    label: '🐦⑬ 日常（飲み）',
    category: 'x',
    prompt: `金曜などの飲み投稿。会社の飲み会断って一人でやってる、明日の出走表とにらめっこ、的な情景。
- 一人飲みのリアル感（赤提灯、ホッピー、モツ煮、コンビニ立ち飲み、家飲み、何でもいい）。
- 同期/同僚との対比（合コン行ってるらしい、私はAIに教師データ食わせてる）は使ってよいが、毎回同じ対比はNG。別の角度から。
- 明日の競馬に繋げるなら "詳しくは明日の朝" くらいに匂わせる程度で十分。`,
    requiredFacts: ['venues'],
    lengthHint: '160〜240字',
    hashtagHint: '#金曜の夜 #競馬予想 など最大2個',
  },

  /* ============================== 重賞特化 X 系 9種 ============================== */
  'x-graded-history': {
    id: 'x-graded-history',
    label: '🏆 レースの歴史',
    category: 'x',
    prompt: `重賞レースの歴史・名勝負を語る投稿。レースの成り立ちや過去の名場面を自分の言葉で紹介する。
- 冒頭は「今週は○○（レース名）の週」という入りでOKだが、毎回同じ書き出しにしない。
- そのレースの創設年・格付け変遷・舞台の特徴に軽く触れつつ、過去の名勝負を1〜2つ具体的に挙げる。
- 「あの年のあのレースは鳥肌だった」系の熱量で語る。年号・馬名・騎手名を正確に。
- ウィキペディアのコピペっぽくならないこと。自分の目線・感情を入れる。
- 締めは「今年はどんなドラマがあるか」系で、今週末への期待に繋げる。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance'],
    lengthHint: '220〜280字',
    hashtagHint: '#{raceName} #競馬 など最大3個',
  },

  'x-graded-memory': {
    id: 'x-graded-memory',
    label: '🏆 思い出話',
    category: 'x',
    prompt: `重賞レースにまつわる自分の思い出・馬券エピソードを語る投稿。
- 「この時期になると思い出す」「○○と聞くと条件反射で…」みたいな入り。
- 過去にそのレースで大勝ちした話、大負けした話、推し馬が走った/走らなかった話。
- リアルな感情（興奮、絶望、酔った勢いで買った、仕事中にこっそり見てた等）を込める。
- 全部フィクションでもいいが、リアリティがあること。「体験談」として自然に読めること。
- 教訓めいた締め（「あれ以来○○は買わないことにしてる」等）があると味が出る。`,
    requiredFacts: ['raceName', 'grade'],
    lengthHint: '200〜280字',
    hashtagHint: '#{raceName} #競馬の思い出 など最大2個',
  },

  'x-graded-data': {
    id: 'x-graded-data',
    label: '🏆 データ考察',
    category: 'x',
    prompt: `重賞レースのコースデータ・種牡馬・傾向など、予想に使える情報を紹介する投稿。
- 「○○のデータ、ちょっと面白いの見つけた」みたいなフォロワーに向けた入り。
- コース（場×馬場×距離）の特徴、有利な脚質・枠順、過去の勝ち馬の共通点を2〜3点。
- 種牡馬適性に1つは触れる（「ディープ系が強いけど今年は…」等）。
- 数字は入れるが、箇条書きの羅列にしない。自然な文章で。
- 「このデータ知ってると馬券の精度変わる」系の主張を毎回違う言い方で。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance'],
    lengthHint: '220〜280字',
    hashtagHint: '#{raceName} #競馬データ など最大3個',
  },

  'x-graded-preview': {
    id: 'x-graded-preview',
    label: '🏆 出走馬注目点',
    category: 'x',
    prompt: `枠順確定後の重賞レース、出走馬の注目ポイントを紹介する投稿。
- 枠順が出たことに触れつつ、「面白い並びになった」「この枠は…」系の入り。
- 全頭には触れず、鍵を握る3〜4頭に絞って注目点を述べる。
- 枠順の有利/不利、展開予想（逃げ馬の位置取り、差し馬の外枠等）にも言及。
- AIのスコアの具体数値は出さないが、「データ的に面白い」「穴を開けそう」等の表現はOK。
- 最終結論は出さず「明日の朝に詳しく出す」系で引っ張る。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance', 'pivot_name'],
    lengthHint: '230〜280字',
    hashtagHint: '#{raceName} #枠順確定 など最大3個',
  },

  'x-graded-ranking': {
    id: 'x-graded-ranking',
    label: '🏆 全頭短評',
    category: 'x',
    prompt: `重賞レースの全出走馬に一言ずつコメントする投稿。280字ギリギリを使う。
- 冒頭は「○○、全頭見た感想を一言ずつ」系のシンプルな入り。
- 各馬を馬番と馬名で「①xxxxxx→コメント」の形式で簡潔に。
- コメントは5〜15字程度。データ的な根拠（種牡馬適性、コース実績等）をベースに。
- 推し馬には「◎」を付ける。対抗馬には「○」。穴候補には「△」。
- 全頭に触れることが最優先。文字数を超えそうなら各馬のコメントを削る。`,
    requiredFacts: ['raceName', 'grade', 'venue'],
    lengthHint: '250〜280字',
    hashtagHint: '#{raceName} #全頭診断 など最大2個',
  },

  'x-graded-odds': {
    id: 'x-graded-odds',
    label: '🏆 オッズ考察',
    category: 'x',
    prompt: `重賞レースのオッズと実力の乖離を考察する投稿。妙味ある馬を紹介する。
- 「前売りオッズ見てたら面白いの見つけた」系の入り。
- 人気馬のオッズが妥当かどうか、1〜2頭を例に挙げて論じる。
- 「この馬、人気ほど強くないかも」or「この人気薄、データ的にはもっと走れる」のロジック。
- 「オッズは大衆心理。データは事実。そのギャップが期待値」という哲学を毎回違う言い方で。
- 具体的なオッズの数字を出していい（「単勝8倍は過小評価では」等）。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'pivot_name'],
    lengthHint: '200〜280字',
    hashtagHint: '#{raceName} #オッズ分析 など最大3個',
  },

  'x-graded-keyhorse': {
    id: 'x-graded-keyhorse',
    label: '🏆 鍵馬ピック',
    category: 'x',
    prompt: `重賞レースの展開の鍵を握る1頭にフォーカスした投稿。
- 「このレース、○○がどう動くかで全部変わる」系の入り。
- 逃げ馬のペース、有力馬の位置取り、展開のキーになる1頭を選ぶ。
- その馬自体を買う/買わないではなく、「この馬の動きで他の馬券が変わる」という視点。
- 展開論（ペース予想、位置取り、直線の長さとの相性等）を中心に語る。
- 「この馬次第で本命が飛ぶ可能性もある」系の含みを持たせる締め。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance'],
    lengthHint: '200〜280字',
    hashtagHint: '#{raceName} #展開予想 など最大3個',
  },

  'x-graded-countdown': {
    id: 'x-graded-countdown',
    label: '🏆 直前カウントダウン',
    category: 'x',
    prompt: `重賞レース当日朝の最終見解投稿。テンション高め、自信を持って結論を出す。
- 「今日だ。○○の日。」みたいな短い一文から入る。テンションMAX。
- 昨夜までデータ回してた感、朝から集中してる感を出す。
- ◎本命の最終結論（馬番・馬名・推し理由を簡潔に）。
- ワイドの相手候補も1〜2頭。
- 「データが導いた答えを信じる」系の自信ある締め。ただし毎回違う言い方で。
- 負けた時のことは考えない。今日は勝つ前提で書く。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'pivot_num', 'pivot_name', 'pivot_reasons'],
    lengthHint: '200〜260字',
    hashtagHint: '#{raceName} #最終予想 など最大3個',
  },

  'x-graded-upset': {
    id: 'x-graded-upset',
    label: '🏆 激走穴馬',
    category: 'x',
    prompt: `重賞レースの激走候補＝人気薄だが走る可能性のある穴馬を紹介する投稿。
- 「みんなノーマークだろうけど、これ怖いよ」系の入り。
- 1〜2頭の穴馬候補を挙げる。人気薄（単勝10倍以上目安）だがデータ的に根拠がある馬。
- 推す理由を具体的に：種牡馬のコース適性、前走の着差・上がりタイム、ローテーションの妙、鞍上の乗り替わり効果等。
- 「人気が無い＝実力が無い、ではない。市場が見落としてるだけ」というロジック。
- 穴馬券の買い方（ワイド紐・3連複の紐）にも軽く触れていい。
- 外れても「狙い自体は間違ってなかった」と言える論理的な根拠を示す。`,
    requiredFacts: ['raceName', 'grade', 'venue', 'surface', 'distance'],
    lengthHint: '220〜280字',
    hashtagHint: '#{raceName} #穴馬 #激走候補 など最大3個',
  },

  /* ============================== note 系（既存テンプレ維持） ============================== */
  // note は長文で構造性が必要なため、当面は既存テンプレ + 変数置換のままにする
};

/** カテゴリでフィルタ */
export function getPostTypesByCategory(category: 'x' | 'note'): PostType[] {
  return Object.values(POST_TYPES).filter(t => t.category === category);
}

/** 1個取得 */
export function getPostType(id: string): PostType | null {
  return POST_TYPES[id] || null;
}
