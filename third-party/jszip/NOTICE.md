# JSZip runtime notice

The extension uses the existing installed JSZip 3.10.2 browser build to read a publicly exported EasyEDA project archive during footprint verification. No new package dependency is introduced. The library is bundled into the extension entry by esbuild.

JSZip: https://github.com/Stuk/jszip . This project elects the MIT option of JSZip's dual MIT/GPLv3 license. The upstream license text is retained in LICENSE.markdown. The browser distribution identifies pako as a bundled dependency; its license is retained in pako-LICENSE. Notices for JSZip's installed direct runtime dependencies lie, readable-stream and setimmediate are also retained alongside it.

The project export is read in memory using File.arrayBuffer(); this use does not write, save, repair or upload EDA documents.
