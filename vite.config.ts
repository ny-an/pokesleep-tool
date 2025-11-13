import { defineConfig } from 'vite'
import eslint from 'vite-plugin-eslint';
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import path from 'path';
import fs from 'fs';

// APIファイルからReactを除外するプラグイン
function excludeReactFromApi() {
  const apiEntryPoints = new Set();
  const apiModules = new Set();
  
  return {
    name: 'exclude-react-from-api',
    buildStart(options) {
      // APIエントリーポイントを記録
      if (options.input) {
        const inputs = typeof options.input === 'string' ? [options.input] :
                      Array.isArray(options.input) ? options.input :
                      Object.values(options.input);
        for (const input of inputs) {
          if (input.includes('/api/strength.html') ||
              input.includes('/api/serialize.html') ||
              input.includes('/api/deserialize.html')) {
            apiEntryPoints.add(input);
            console.log('[DEBUG] buildStart - API entry point:', input);
          }
        }
      }
    },
    moduleParsed(moduleInfo) {
      // APIエントリーポイントから参照されているモジュールを記録
      if (moduleInfo.id) {
        const isApiEntry = Array.from(apiEntryPoints).some(entry => 
          moduleInfo.id.includes(entry.replace(/\\/g, '/'))
        );
        
        if (isApiEntry) {
          apiModules.add(moduleInfo.id);
          console.log('[DEBUG] moduleParsed - API entry module:', moduleInfo.id);
        } else if (moduleInfo.importers) {
          for (const importer of moduleInfo.importers) {
            if (apiModules.has(importer)) {
              apiModules.add(moduleInfo.id);
              console.log('[DEBUG] moduleParsed - API module (via importer):', moduleInfo.id, 'from', importer);
              break;
            }
          }
        }
      }
    },
    resolveId(id, importer) {
      // React関連のモジュールかチェック
      const isReactModule = id === 'react' || id === 'react-dom' || id === 'react/jsx-runtime' || 
                            id === 'react-i18next' || id.startsWith('react/') || id.startsWith('react-dom/');
      
      if (!isReactModule) return null;
      
      // デバッグ: すべてのReactモジュールの解決をログに記録
      console.log('[DEBUG] resolveId - React module requested:', id, 'from', importer || '(no importer)');
      
      // importerがAPIモジュールかチェック
      if (importer && apiModules.has(importer)) {
        console.log('[DEBUG] resolveId - Excluding React module (apiModules):', id, 'from', importer);
        // 空のモジュールを返す
        return { id: '\0virtual:react-stub', moduleSideEffects: false };
      }
      
      // フォールバック: importerがAPIエントリーポイントまたはapi/で始まるJSファイルかチェック
      if (importer) {
        // より広範囲なチェック
        const isApiImporter = 
          // HTMLエントリーポイント
          importer.includes('/api/strength.html') ||
          importer.includes('/api/serialize.html') ||
          importer.includes('/api/deserialize.html') ||
          // HTMLプロキシ（Viteが生成する）
          importer.includes('api/strength.html?') ||
          importer.includes('api/serialize.html?') ||
          importer.includes('api/deserialize.html?') ||
          // JSファイル（生成されたもの）
          (importer.includes('/api/') && importer.endsWith('.js')) ||
          // 絶対パスやビルド後のパスも考慮
          importer.includes('api/strength') ||
          importer.includes('api/serialize') ||
          importer.includes('api/deserialize') ||
          // モジュールIDにapi/が含まれる場合
          (importer.includes('api') && (importer.includes('strength') || importer.includes('serialize') || importer.includes('deserialize')));
        
        if (isApiImporter) {
          console.log('[DEBUG] resolveId - Excluding React module (fallback):', id, 'from', importer);
          // 空のモジュールを返す
          return { id: '\0virtual:react-stub', moduleSideEffects: false };
        } else {
          console.log('[DEBUG] resolveId - NOT excluding React module:', id, 'from', importer, '(not API importer)');
        }
      } else {
        console.log('[DEBUG] resolveId - React module requested without importer:', id);
      }
      return null;
    },
    load(id) {
      if (id === '\0virtual:react-stub') {
        // 空のモジュールを返す
        return 'export default {};';
      }
      return null;
    },
    generateBundle(options, bundle) {
      console.log('[DEBUG] generateBundle called, bundle keys:', Object.keys(bundle));
      
      // 生成されたJSファイルをapiModulesに追加
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk && chunk.type === 'chunk' && fileName.startsWith('api/')) {
          // 生成されたJSファイルのモジュールIDをapiModulesに追加
          if (chunk.facadeModuleId) {
            apiModules.add(chunk.facadeModuleId);
            console.log('[DEBUG] generateBundle - Added API JS file to apiModules:', fileName, 'facadeModuleId:', chunk.facadeModuleId);
          }
          // チャンクに含まれるすべてのモジュールをapiModulesに追加
          if (chunk.modules) {
            for (const moduleId of Object.keys(chunk.modules)) {
              apiModules.add(moduleId);
            }
            console.log('[DEBUG] generateBundle - Added', Object.keys(chunk.modules).length, 'modules from', fileName, 'to apiModules');
          }
        }
      }
      
      // APIファイルのHTMLからReactチャンクへの参照を削除
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk && chunk.type === 'asset') {
          console.log('[DEBUG] generateBundle - asset:', fileName, 'type:', chunk.type);
          if (fileName.includes('api/') && fileName.endsWith('.html')) {
            console.log('[DEBUG] Processing API HTML file in generateBundle:', fileName);
            const asset = chunk as { type: 'asset'; source: string | Uint8Array };
            if (typeof asset.source === 'string') {
              const originalHtml = asset.source;
              const reactMatches = originalHtml.match(/react[^"]*\.js/gi) || [];
              const vendorMatches = originalHtml.match(/vendor[^"]*\.js/gi) || [];
              console.log('[DEBUG] generateBundle - Found React matches:', reactMatches);
              console.log('[DEBUG] generateBundle - Found Vendor matches:', vendorMatches);
              
              // Reactチャンクとvendorチャンクへの参照を削除（より広範囲にマッチ）
              const cleanedHtml = originalHtml
                .replace(/<script[^>]*src="[^"]*react[^"]*\.js"[^>]*><\/script>\s*/gi, '')
                .replace(/<script[^>]*src="[^"]*vendor[^"]*\.js"[^>]*><\/script>\s*/gi, '')
                .replace(/<link[^>]*href="[^"]*react[^"]*\.js"[^>]*>\s*/gi, '')
                .replace(/<link[^>]*href="[^"]*vendor[^"]*\.js"[^>]*>\s*/gi, '')
                .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*react[^"]*\.js"[^>]*>\s*/gi, '')
                .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*vendor[^"]*\.js"[^>]*>\s*/gi, '');
              
              const afterReactMatches = cleanedHtml.match(/react[^"]*\.js/gi) || [];
              const afterVendorMatches = cleanedHtml.match(/vendor[^"]*\.js/gi) || [];
              console.log('[DEBUG] generateBundle - After cleanup - React matches:', afterReactMatches);
              console.log('[DEBUG] generateBundle - After cleanup - Vendor matches:', afterVendorMatches);
              console.log('[DEBUG] generateBundle - HTML length changed:', originalHtml.length, '->', cleanedHtml.length);
              
              asset.source = cleanedHtml;
            }
          }
        }
      }
    },
    writeBundle(options, bundle) {
      console.log('[DEBUG] writeBundle called, bundle keys:', Object.keys(bundle));
      const outDir = options.dir || 'dist';
      console.log('[DEBUG] Output directory:', outDir);
      
      // すべてのHTMLファイルを確認
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk && chunk.type === 'asset' && fileName.endsWith('.html')) {
          console.log('[DEBUG] writeBundle - Found HTML file:', fileName);
        }
      }
      
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk && chunk.type === 'asset' && fileName.includes('api/') && fileName.endsWith('.html')) {
          console.log('[DEBUG] Processing API HTML file in writeBundle:', fileName);
          const filePath = path.join(outDir, fileName);
          console.log('[DEBUG] File path:', filePath);
          if (fs.existsSync(filePath)) {
            let html = fs.readFileSync(filePath, 'utf-8');
            const beforeLength = html.length;
            // より詳細なマッチング（baseパスを含む可能性を考慮）
            const reactMatches = html.match(/react[^"'\s]*\.js/gi) || [];
            const vendorMatches = html.match(/vendor[^"'\s]*\.js/gi) || [];
            console.log('[DEBUG] writeBundle - Found React matches:', reactMatches);
            console.log('[DEBUG] writeBundle - Found Vendor matches:', vendorMatches);
            console.log('[DEBUG] writeBundle - HTML preview (first 500 chars):', html.substring(0, 500));
            
            // Reactチャンクとvendorチャンクへの参照を削除（より広範囲にマッチ）
            html = html
              .replace(/<script[^>]*src="[^"]*react[^"'\s]*\.js"[^>]*><\/script>\s*/gi, '')
              .replace(/<script[^>]*src="[^"]*vendor[^"'\s]*\.js"[^>]*><\/script>\s*/gi, '')
              .replace(/<link[^>]*href="[^"]*react[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*href="[^"]*vendor[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*react[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*vendor[^"'\s]*\.js"[^>]*>\s*/gi, '')
              // baseパスを含む場合も考慮
              .replace(/<script[^>]*src="[^"]*\/pokesleep-tool\/[^"]*react[^"'\s]*\.js"[^>]*><\/script>\s*/gi, '')
              .replace(/<script[^>]*src="[^"]*\/pokesleep-tool\/[^"]*vendor[^"'\s]*\.js"[^>]*><\/script>\s*/gi, '')
              .replace(/<link[^>]*href="[^"]*\/pokesleep-tool\/[^"]*react[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*href="[^"]*\/pokesleep-tool\/[^"]*vendor[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*\/pokesleep-tool\/[^"]*react[^"'\s]*\.js"[^>]*>\s*/gi, '')
              .replace(/<link[^>]*rel="modulepreload"[^>]*href="[^"]*\/pokesleep-tool\/[^"]*vendor[^"'\s]*\.js"[^>]*>\s*/gi, '');
            
            const afterReactMatches = html.match(/react[^"'\s]*\.js/gi) || [];
            const afterVendorMatches = html.match(/vendor[^"'\s]*\.js/gi) || [];
            console.log('[DEBUG] writeBundle - After cleanup - React matches:', afterReactMatches);
            console.log('[DEBUG] writeBundle - After cleanup - Vendor matches:', afterVendorMatches);
            console.log('[DEBUG] writeBundle - HTML length changed:', beforeLength, '->', html.length);
            console.log('[DEBUG] writeBundle - HTML preview after cleanup (first 500 chars):', html.substring(0, 500));
            
            fs.writeFileSync(filePath, html, 'utf-8');
            console.log('[DEBUG] writeBundle - File written:', filePath);
          } else {
            console.log('[DEBUG] writeBundle - File not found:', filePath);
          }
        }
      }
    },
  };
}

export default defineConfig({
  base: '/pokesleep-tool/',
  plugins: [
    excludeReactFromApi(),
    eslint(), 
    react({
      // APIファイルにはReactプラグインを適用しない
      exclude: /\/api\/.*\.html$/,
    })
  ],
  build: {
    rollupOptions: {
      input: {
        reserchEn: path.resolve(__dirname, 'index.html'),
        reserchJa: path.resolve(__dirname, 'index.ja.html'),
        reserchKo: path.resolve(__dirname, 'index.ko.html'),
        reserchZhCn: path.resolve(__dirname, 'index.zh-cn.html'),
        reserchZhTw: path.resolve(__dirname, 'index.zh-tw.html'),
        ivEn: path.resolve(__dirname, 'iv/index.html'),
        ivJa: path.resolve(__dirname, 'iv/index.ja.html'),
        ivKo: path.resolve(__dirname, 'iv/index.ko.html'),
        ivZhCn: path.resolve(__dirname, 'iv/index.zh-cn.html'),
        ivZhTw: path.resolve(__dirname, 'iv/index.zh-tw.html'),
        apiSerialize: path.resolve(__dirname, 'api/serialize.html'),
        apiDeserialize: path.resolve(__dirname, 'api/deserialize.html'),
        apiStrength: path.resolve(__dirname, 'api/strength.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // APIファイルのエントリーポイントはapiディレクトリに配置
          const name = chunkInfo.name || '';
          const facadeModuleId = chunkInfo.facadeModuleId || '';
          if (name.startsWith('api') || facadeModuleId.includes('/api/')) {
            return 'api/[name]-[hash].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          // APIファイルのHTMLはapiディレクトリに配置
          if (assetInfo.name && (assetInfo.name.includes('serialize.html') || 
              assetInfo.name.includes('deserialize.html') || 
              assetInfo.name.includes('strength.html'))) {
            return 'api/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        manualChunks(id, { getModuleInfo }) {
          const moduleInfo = getModuleInfo(id);
          if (!moduleInfo) return undefined;

          // シンプルな判定：モジュールIDにapi/が含まれているか、またはAPIエントリーポイントから直接参照されているか
          const isApiEntry = id.includes('/api/strength.html') ||
                             id.includes('/api/serialize.html') ||
                             id.includes('/api/deserialize.html');
          
          // このモジュールがAPIエントリーポイントから参照されているかチェック（簡易版）
          let isApiModule = false;
          if (isApiEntry) {
            isApiModule = true;
            if (id.includes('node_modules') && (id.includes('react') || id.includes('vendor'))) {
              console.log('[DEBUG] manualChunks - API entry with React/vendor:', id);
            }
          } else {
            // インポーターを1階層だけチェック（パフォーマンス向上）
            for (const importer of moduleInfo.importers || []) {
              const importerInfo = getModuleInfo(importer);
              if (importerInfo?.isEntry && (
                importer.includes('/api/strength.html') ||
                importer.includes('/api/serialize.html') ||
                importer.includes('/api/deserialize.html')
              )) {
                isApiModule = true;
                if (id.includes('node_modules') && (id.includes('react') || id.includes('vendor'))) {
                  console.log('[DEBUG] manualChunks - API module with React/vendor:', id, 'from', importer);
                }
                break;
              }
            }
          }

          // Third-party libraries
          if (id.includes('node_modules')) {
            if (id.includes('@mui') || id.includes('@emotion')) {
              // APIファイルはMUIを含まない
              return isApiModule ? undefined : 'mui';
            }
            // react-i18nextはreactチャンクに含めるが、i18nextは別チャンクに
            if (id.includes('react-i18next')) {
              // APIファイルはreact-i18nextを含まない
              return isApiModule ? undefined : 'react';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              // APIファイルはReactを含まない
              return isApiModule ? undefined : 'react';
            }
            // i18nextは独立したチャンクに（APIファイルで使用）
            if (id.includes('i18next') && !id.includes('react-i18next')) {
              return isApiModule ? 'api-i18n-core' : 'i18n-core';
            }
            // その他のvendorライブラリ
            return isApiModule ? 'api-vendor' : 'vendor';
          }

          if (id.includes('pokemon.json')) {
            return isApiModule ? 'api-pokemon' : 'pokemon';
          }
          if (id.includes('field.json')) {
            return isApiModule ? 'api-field' : 'field';
          }
          if (id.includes('event.json')) {
            return isApiModule ? 'api-event' : 'event';
          }
          if (id.includes('news.json')) {
            return isApiModule ? 'api-news' : 'news';
          }
          if (id.includes('/src/i18n/') || id.includes('/src/i18n.ts')) {
            // APIファイルはreact-i18nextを使うi18n.tsを含まない
            return isApiModule ? undefined : 'i18n';
          }
          if (id.includes('/src/i18n-api.ts')) {
            return 'api-i18n';
          }
          if (id.includes('PokemonIconData.ts')) {
            return isApiModule ? 'api-pokemon-icon' : 'pokemon-icon';
          }
          if (id.includes('ui/Resources')) {
            return isApiModule ? 'api-svg-icon' : 'svg-icon';
          }
          // Catch-all for any other data files
          if (id.includes('/src/data')) {
            return isApiModule ? 'api-data' : 'data';
          }

          // Utility modules
          if (id.includes('/src/util/')) {
            return isApiModule ? 'api-util' : 'util';
          }

          // Common UI components (Dialog, common, etc.)
          if (id.includes('/src/ui/')) {
            // APIファイルはUIコンポーネントを含まない
            return isApiModule ? undefined : 'ui';
          }

          return undefined;
        }
      }
    },
  },
  server: {
    open: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [...configDefaults.exclude],
  },
})
