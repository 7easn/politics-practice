# 正式题目发布门槛（工程候选，尚未发布）

“已核验/已审校”等历史状态、来源短摘核验、变式局部审核、显示或技术测试，均不能代替当前整题独立审核。保留历史记录及其有效范围，不自动升级。

正式构建使用 `scripts/build_subject_package.py --review-index <私有台账> --evidence-root <私有证据目录>`。声明 reviewed 或 reviewed-with-limitations 时，必须重新读取实际证据文件并全部通过，否则不会创建ZIP。incomplete 只供运输/审校工作台；客户端题目练习统计不采纳仅有状态标签的题目。知识、覆盖、原断言及来源仍各自显示原审核范围。

私有台账格式为 `question-review-index-v1`，records 每条包含 question_id、证据相对路径 artifact、该文件真实 SHA256。证据文件格式为 `independent-question-review-v1`，记录 author、不同的 reviewer、completed=true、completed_at、scope=whole-question，reviews 包含对应题号的一条记录。每条必须 decision=passed，携带实际独立审过的 question_snapshot 与 source_snapshots（按引用来源ID映射完整来源记录）。**不能拿当前未审内容生成快照，并倒签旧审核。** 旧证据只能在实际范围与快照完整对应时，由内容负责人建立明确的证据链；缺失的维度须补审。

既有真实审核可使用 provenance_mode=composed-legacy-reviews 组合：legacy_evidence_chain 每项必须保留实际证据相对路径 artifact、文件SHA256、具体 record_locator、原范围 scope。构建逐项重读原文件并校验SHA，不只信任派生快照。原审核时间和适配时间分别保留，不回填缺失的人工审核时间；窄范围来源、变式或字段补丁仅补相应维度，不替代原整题审核。

每条还须携带 note_snapshots（定位ID对应实际审过的完整段落记录）及 document_sha256（所引用原Word文件名对应实读文件SHA）。正式构建与门槛命令读取当前notes和documents，核对定位、文件对应关系、段落版本，以及Word实际字节的SHA。生成的练习证据仅导出段落哈希与Word哈希，不复制原笔记全文；完整包本机校验同时比对笔记和Word版本。

checks 必须逐项给出 status=passed 和实质性 evidence：prompt、answer、explanation、scoring、variants、note_provenance、source_support、original_claim_limits。选择题评分维度须明确正确项、干扰项、计分限制；主观题须核对当前评分点、分值、子标准及变式答法。未核准原断言可保留在订正/待证台账，审核者须明确它未被偷换为正确答案或已完成覆盖。

构建后 questionReviews 数组保留逐题证据来源、独立审核者、八项结论与版本哈希；practiceRelease 保存汇总。绑定算法 typed-tree-ieee754-v1 将JSON递归表示为带类型树：null、boolean、string、array、object（键按UTF16排序）；number 为 IEEE754 大端8字节的十六进制。对该树紧凑UTF8 JSON取SHA256。整题全部字段及完整来源记录参与绑定，不更改原题内容或小数分值。浏览器重新计算题目与来源哈希，任何题干、答案、解析、评分、变式、定位或来源版本变化都使资格失效。该校验验证证据与版本一致性；实际完成独立阅读及判断仍由具名审核者负责，不能用机器校验冒充人工审核。

显式 practice_enabled=false / safe_for_quiz=false 的条目须有 disabled_reason、duplicate_of 或 quiz_release_block，可保留导航与历史ID，不计正式题数。此排除不能用于偷偷删除未完成目标；覆盖和订正台账必须继续保留这些目标的真实状态。

单独检查并输出失败台账：

```sh
python3 scripts/question_release_gate.py --bank PRIVATE_BANK --notes PRIVATE_NOTES --documents PRIVATE_DOCUMENTS --index PRIVATE_INDEX --evidence-root PRIVATE_EVIDENCE --report PRIVATE_REPORT
```

当前严格门槛还没有对真实完整题库通过，不得把运输测试成功或已保存的工程候选当作最终完整包交付。发布授权仍以内容负责人最终交接、实际全题门槛通过为条件。服务端现有协议负责分片完整性、权限、收据和原子切换；此次逐题语义证据校验是正式构建及学习客户端门槛，尚不宣称服务端能验证人工审核事实。
