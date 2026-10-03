# 每科私有完整包 v1（本地工程候选，尚未发布）

每个 ZIP 只装一科（psychology / politics / english）；每科拥有独立版本和激活指针。文件清单完整不等于知识覆盖或审校完成。尚未完成的知识点、原文和权威证据须原样标明。包内不得包含登录凭据或学习记录。

正式构建及练习启用还须通过[当前整题独立审核门槛](question-release-gate.md)。历史状态、局部变式审核、来源短摘或技术测试不能替代该门槛；incomplete 工程包不导出练习资格。

容器为 ZIP_STORED，不用压缩扩展、加密或 ZIP64。manifest.json 声明 format=private-subject-package、schema_version=1、subject、package_version、semantic_review（explicit status/scope/limitations）和 objects 清单。每个条目包含 index/path/role/component/field/start/count/bytes/sha256；JSON 根条目与数组分片上限 256 KiB；每份Word上限8 MiB（本批最大475422字节），以原始二进制分片条目保存，不反复嵌入 base64 JSON。manifest 限制 128 KiB，总量限制 128 MiB、最多 2048 条目。这些是容器资源限制，不是扩大现有单次题库 JSON 上传限制。

服务端创建草稿时固定 subject、manifest 和 expected_active（原包 SHA 或 legacy）；逐条上传时计算实际 SHA、字节长度、解析小 JSON、验证题号及笔记定位，不信任客户端“已核验”。已确认条目不可改写，重试返回同一收据。浏览器按账户、科目及清单SHA保留小型基线恢复标记；刷新重选文件仍沿用原基线，若本科已更新则拒绝自动重基或覆盖。标记不含题库内容或凭据。每个分片单独请求，原始Word另按文件逐一验证整文件SHA并生成独立收据；最终提交只检查固定清单及文件验证收据、ID 唯一性和基线，并原子切换单个 subject 指针，不拼接或解析全量题库，不更改 statement_timeout、允许名单或 RLS。

读取先查询本科完整包指针；无完整包时使用既有 psychology/notes/documents 读取。完整包对象逐块校验后在浏览器重建对应资料。失败保留当前活动版本；更新成功也须手动切换学习内容。稳定题号、账户学习记录和本机草稿不随 package_version 重建。更新心理学不写政治/英语指针。

首次包激活须固定 legacy baseline（包括旧题库、笔记、Word 激活指针），避免上传期间旧导入改变基线。之后完整包与旧导入不能并行覆盖同一科；新协议不调用旧全量提交或 subjective CAS。旧版历史仍保留。最终物理部署与远端迁移需按具体候选版本确认。
