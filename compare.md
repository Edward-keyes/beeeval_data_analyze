| 评估维度   | Whisper                                                      | FunASR                                                       | Moonshine                                                    | 分析总结                                                     |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 速度性能   | 23.64秒 (RTF=0.97)                                           | 28.22秒 (RTF=1.16)                                           | 5.57秒 (RTF=0.23)                                            | **Moonshine速度优势巨大**，处理速度是Whisper的4倍多，FunASR的5倍多。RTF远小于1，效率极高。 |
| 转录准确度 | 整体通顺，但将“小爱”误识别为“小艾”。英文部分识别为“Jordan beats the power”。 | **准确度最高**。正确识别“小爱同学”，文本通顺且**自动添加了标点符号**。英文处理为“jordan beats的power”。 | **存在严重错误**。将“每一步踩都”错误识别为“哪一部彩都”，且漏掉了“汗水与节拍共振”一句。 | **FunASR的准确性和文本规整性最好**。Whisper有小瑕疵。Moonshine出现了影响理解的错误。 |
| 输出格式   | 提供**9个**精细的时间戳片段，对齐详细。                      | 仅提供**2个**时间戳片段，分段非常粗略。                      | 提供5个片段，但时间戳存在重叠（如第4、5段），可能有问题。    | **Whisper的时间戳最详细实用**，适合需要精确定位场景。FunASR和Moonshine的片段信息较粗糙。 |
| 综合效率   | 速度中等，准确度良好，细节丰富。                             | 速度最慢，但准确度和可读性最佳。                             | **速度极快，但准确度牺牲太大**，关键信息识别错误。           | 选择需权衡：**重准确选FunASR，重速度选Moonshine，求平衡选Whisper**。 |



测试详情内容：

whisper模型:

2026-03-17 11:07:08 | INFO     | __main__:test_transcription:84 - Transcription completed in: 23.64s                    
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:112 - Audio duration: 24.32s                               
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:113 - RTF (Real-Time Factor): 0.9719                       
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:121 - Results saved to: whisper_result.json                
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:124 - ==================================================   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:125 - TRANSCRIPTION SUMMARY                                
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:126 - ==================================================   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:127 - Full Text (70 chars):                                
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:128 - --------------------------------------------------   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:129 - 小艾同学在推荐一些适合在健身房听的音乐Jordan beats the power节奏强劲每一步踩都燃起斗志汗水与节拍共振让坚持变得更有力量                                                       
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:130 - --------------------------------------------------   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:133 -                                                      
Segments with timestamps:                                                                                               
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [1] 0.48s - 1.48s: 小艾同学                        
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [2] 2.04s - 2.32s: 在                              
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [3] 2.32s - 2.96s: 推荐一些                        
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [4] 2.96s - 4.84s: 适合在健身房听的音乐            
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [5] 9.56s - 11.04s: Jordan beats the power         
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [6] 11.04s - 12.04s: 节奏强劲                      
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [7] 12.32s - 14.12s: 每一步踩都燃起斗志            
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [8] 14.32s - 15.76s: 汗水与节拍共振                
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:135 -   [9] 16.08s - 17.88s: 让坚持变得更有力量            
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:139 - ==================================================   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:140 - METRICS                                              
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:141 - ==================================================   
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   audio_extract_time_sec: 0.776                      
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   transcription_time_sec: 23.637                     
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   total_duration_sec: 24.414                         
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   text_length: 70                                    
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   words_count: 4                                     
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   rtf: 0.9719                                        
2026-03-17 11:07:08 | INFO     | __main__:test_transcription:143 -   audio_duration_sec: 24.32    

------------------------------------------------------------

funasr模型：

2026-03-17 11:12:44 | INFO     | __main__:test_transcription:84 - Transcription completed in: 28.22s
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:112 - Audio duration: 24.32s
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:113 - RTF (Real-Time Factor): 1.1604
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:121 - Results saved to: funasr_result.json
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:124 - ==================================================
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:125 - TRANSCRIPTION SUMMARY
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:126 - ==================================================
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:127 - Full Text (71 chars):
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:128 - --------------------------------------------------
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:129 - 小爱同学在推荐一些适合在健身房听的音乐，jordan beats的power节奏强劲，每一步踩都燃起斗志，汗水与节拍共振，让坚持变得更有力量。
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:130 - --------------------------------------------------
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:133 -
Segments with timestamps:
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:135 -   [1] 0.54s - 0.72s: 小爱同学在推荐一些适合在健身房听的音乐，jordan
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:135 -   [2] 0.72s - 0.90s: beats的power节奏强劲，每一步踩都燃起斗志，汗水与节拍共振，让坚持变得更有力量。
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:139 - ==================================================
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:140 - METRICS
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:141 - ==================================================
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   audio_extract_time_sec: 0.765
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   transcription_time_sec: 28.221
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   total_duration_sec: 28.985
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   text_length: 71
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   words_count: 2
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   rtf: 1.1604
2026-03-17 11:12:44 | INFO     | __main__:test_transcription:143 -   audio_duration_sec: 24.32

-----------------------------------------------

moonshine模型：

2026-03-17 11:05:58 | INFO     | __main__:test_transcription:84 - Transcription completed in: 5.57s
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:112 - Audio duration: 24.32s
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:113 - RTF (Real-Time Factor): 0.2288
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:124 - ==================================================
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:125 - TRANSCRIPTION SUMMARY
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:126 - ==================================================
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:127 - Full Text (71 chars):
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:128 - --------------------------------------------------
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:129 - 小爱同学。 再推荐一些适合在健身房听 Jordan beats的power节奏强劲。 哪 一 部 彩 都 燃 起 斗 志 让坚持变得更有力量。
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:130 - --------------------------------------------------
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:133 -
Segments with timestamps:
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:135 -   [1] 0.35s - 1.76s: 小爱同学。
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:135 -   [2] 1.92s - 5.09s: 再推荐一些适合在健身房听
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:135 -   [3] 9.54s - 12.38s: Jordan beats的power节奏强劲。
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:135 -   [4] 12.19s - 16.10s: 哪 一 部 彩 都 燃 起 斗 志
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:135 -   [5] 15.94s - 18.21s: 让坚持变得更有力量。
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:139 - ==================================================
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:140 - METRICS
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:141 - ==================================================
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   audio_extract_time_sec: 0.777
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   transcription_time_sec: 5.566
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   total_duration_sec: 6.343
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   text_length: 71
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   words_count: 14
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   rtf: 0.2288
2026-03-17 11:05:58 | INFO     | __main__:test_transcription:143 -   audio_duration_sec: 24.32