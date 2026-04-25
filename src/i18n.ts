import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import existing translations logic, but adapted for i18next structure
const resources = {
  en: {
    translation: {
      // Sidebar
      'console': 'Console',
      'history': 'History',
      'database': 'Database',
      'test_cases': 'Test Cases',
      'settings': 'Settings',
      'version': 'v1.0.0',

      // Home
      'analysis_console': 'Analysis Console',
      'select_folder_desc': 'Select a folder containing smart cabin AI videos to begin.',
      'select_folder': 'Select Folder',
      'scan_folder': 'Scan Folder',
      'scanning': 'Scanning...',
      'click_to_select': 'Click to select folder...',
      'detected_videos': 'Detected Videos',
      'items': 'items',
      'selected': 'selected',
      'start_analysis': 'Start Analysis',
      'analyzing': 'Analyzing...',
      'video_name': 'Video Name',
      'size': 'Size',
      'path': 'Path',
      'progress': 'Progress',
      'processing': 'Processing',
      'done': 'Done',
      'failed': 'Failed',

      // Progress Phases
      'phase_queued': 'Queued',
      'phase_initializing': 'Initializing Analysis',
      'phase_extracting_audio': 'Extracting Audio from Video',
      'phase_audio_extracted': 'Audio Extraction Complete',
      'phase_transcribing': 'Transcribing Audio ({{model}} ASR)',
      'phase_transcription_complete': 'Transcription Complete',
      'phase_capturing_screenshot': 'Capturing System Screenshot',
      'phase_screenshot_captured': 'Screenshot Captured',
      'phase_llm_analysis': 'LLM AI Analysis',
      'phase_llm_complete': 'LLM Analysis Complete',
      'phase_saving_results': 'Saving Results to Database',
      'phase_completed': 'Completed',

      // Database
      'car_model': 'Car Model',
      'query': 'Query',
      'response': 'Response',
      'score': 'Score',
      'latency': 'Latency',
      'summary': 'Summary',
      'file_name': 'File Name',
      'actions': 'Actions',
      'loading_data': 'Loading data...',
      'no_results': 'No results found.',
      'evaluation_details': 'Evaluation Details',
      'screenshot': 'Screenshot',
      'interaction_log': 'Interaction Log',

      // Test Cases
      'test_case_library': 'Test Case Library',
      'filter_by_model': 'Filter by Model',
      'filter_by_case': 'Filter by Case',
      'all_models': 'All Models',
      'all_cases': 'All Cases',
      'test_case': 'Test Case',
      'description': 'Description',
      'evaluation': 'Evaluation',
      
      // NAS Browser
      'nas_browser': 'NAS Browser',
      'nas_browser_desc': 'Browse and analyze videos from NAS storage.',
      'nas_unavailable': 'NAS Unavailable',
      'nas_unavailable_desc': 'NAS service is not configured or unreachable. Check NAS_URL and NAS_TOKEN in .env.',
      'nas_connected': 'Connected',
      'nas_search_placeholder': 'Search files by name...',
      'all_files': 'All Files',
      'videos_only': 'Videos Only',
      'folders_only': 'Folders Only',
      'videos_in_dir': 'videos in directory',
      'select_all': 'Select All',
      'search': 'Search',
      'search_results': 'Search Results',
      'total': 'Total',
      'preview': 'Preview',
      'retry': 'Retry',
      'vector_manager': 'Vector Manager',

      // Vehicle Scores
      'vehicle_scores': 'Vehicle Scores',
      'vehicle_scores_desc': 'Aggregate average scores per metric and per function domain for each vehicle (brand + system version). Click "Compute" to refresh.',
      'vehicle_scores_no_data': 'No scored videos available yet, cannot aggregate.',
      'select_vehicle': 'Select Vehicle',
      'last_computed_at': 'Last Computed',
      'compute_scores': 'Compute',
      'computing': 'Computing...',
      'no_aggregated_yet': 'No cached scores for this vehicle yet. Click "Compute" to generate.',
      'criteria_scores': 'Per-Metric Average',
      'function_domain_scores': 'Per-Domain Average',
      'metrics': 'metrics',
      'domains': 'domains',
      'no_domain_data': 'No function-domain grouping (video filenames may not include the domain).',
      'view_details': 'View details',
      'metric_name': 'Metric',
      'avg_score': 'Avg Score',
      'samples': 'Samples',

      // Common
      'edit': 'Edit',
      'save_changes': 'Save Changes',
      'cancel': 'Cancel'
    }
  },
  zh: {
    translation: {
      // Sidebar
      'console': '控制台',
      'history': '历史记录',
      'database': '数据库',
      'test_cases': '测试用例',
      'settings': '设置',
      'version': 'v1.0.0',

      // Home
      'analysis_console': '分析控制台',
      'select_folder_desc': '选择包含智能座舱 AI 视频的文件夹开始分析。',
      'select_folder': '选择文件夹',
      'scan_folder': '扫描文件夹',
      'scanning': '扫描中...',
      'click_to_select': '点击选择文件夹...',
      'detected_videos': '检测到的视频',
      'items': '个项目',
      'selected': '已选择',
      'start_analysis': '开始分析',
      'analyzing': '分析中...',
      'video_name': '视频名称',
      'size': '大小',
      'path': '路径',
      'progress': '进度',
      'processing': '处理中',
      'done': '完成',
      'failed': '失败',

      // Progress Phases
      'phase_queued': '等待中',
      'phase_initializing': '初始化分析',
      'phase_extracting_audio': '从视频提取音频',
      'phase_audio_extracted': '音频提取完成',
      'phase_transcribing': '音频转录中 ({{model}} ASR)',
      'phase_transcription_complete': '转录完成',
      'phase_capturing_screenshot': '捕获系统截图',
      'phase_screenshot_captured': '截图已捕获',
      'phase_llm_analysis': 'LLM AI 分析中',
      'phase_llm_complete': 'LLM 分析完成',
      'phase_saving_results': '保存结果到数据库',
      'phase_completed': '已完成',

      // Database
      'car_model': '车型',
      'query': '查询',
      'response': '回复',
      'score': '评分',
      'latency': '延迟',
      'summary': '总结',
      'file_name': '文件名',
      'actions': '操作',
      'loading_data': '正在加载数据...',
      'no_results': '未找到结果。',
      'evaluation_details': '评估详情',
      'screenshot': '截图',
      'interaction_log': '交互日志',

      // Test Cases
      'test_case_library': '测试用例库',
      'filter_by_model': '按车型筛选',
      'filter_by_case': '按用例筛选',
      'all_models': '所有车型',
      'all_cases': '所有用例',
      'test_case': '测试用例',
      'description': '描述',
      'evaluation': '评估',
      
      // NAS Browser
      'nas_browser': 'NAS 浏览器',
      'nas_browser_desc': '从 NAS 存储浏览和分析视频。',
      'nas_unavailable': 'NAS 不可用',
      'nas_unavailable_desc': 'NAS 服务未配置或无法连接。请检查 .env 中的 NAS_URL 和 NAS_TOKEN。',
      'nas_connected': '已连接',
      'nas_search_placeholder': '按文件名搜索...',
      'all_files': '全部文件',
      'videos_only': '仅视频',
      'folders_only': '仅文件夹',
      'videos_in_dir': '个视频',
      'select_all': '全选',
      'search': '搜索',
      'search_results': '搜索结果',
      'total': '总计',
      'preview': '预览',
      'retry': '重试',
      'vector_manager': '向量管理',

      // Vehicle Scores
      'vehicle_scores': '车辆评分',
      'vehicle_scores_desc': '按车型 + 系统版本聚合每个指标和功能域的均分。点「一键计算」更新数据。',
      'vehicle_scores_no_data': '当前还没有任何打分视频，无法生成均分。',
      'select_vehicle': '选择车辆',
      'last_computed_at': '上次计算',
      'compute_scores': '一键计算',
      'computing': '计算中…',
      'no_aggregated_yet': '该车暂无均分缓存，请点击「一键计算」生成。',
      'criteria_scores': '指标均分',
      'function_domain_scores': '功能域均分',
      'metrics': '个指标',
      'domains': '个功能域',
      'no_domain_data': '没有功能域分组数据（视频文件名可能未带功能域）。',
      'view_details': '查看明细',
      'metric_name': '指标',
      'avg_score': '均分',
      'samples': '样本',

      // Common
      'edit': '编辑',
      'save_changes': '保存修改',
      'cancel': '取消'
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: "zh", // Default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
