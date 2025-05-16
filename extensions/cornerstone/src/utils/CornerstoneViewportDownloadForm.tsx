import React, { useEffect, useState } from 'react';
import html2canvas from 'html2canvas';
import { getEnabledElement, StackViewport, BaseVolumeViewport } from '@cornerstonejs/core';
import { ToolGroupManager, segmentation, Enums } from '@cornerstonejs/tools';
import { getEnabledElement as OHIFgetEnabledElement } from '../state';
import { useSystem } from '@ohif/core/src';

const DEFAULT_SIZE = 550;
const DEFAULT_HEIGHT = 650;
const MAX_TEXTURE_SIZE = 10000;
const VIEWPORT_ID = 'cornerstone-viewport-download-form';

const FILE_TYPE_OPTIONS = [
  {
    value: 'jpg',
    label: 'JPG',
  },
  {
    value: 'png',
    label: 'PNG',
  },
];

type ViewportDownloadFormProps = {
  hide: () => void;
  activeViewportId: string;
};

const CornerstoneViewportDownloadForm = ({
  hide,
  activeViewportId: activeViewportIdProp,
}: ViewportDownloadFormProps) => {
  const { servicesManager } = useSystem();
  const { customizationService, cornerstoneViewportService } = servicesManager.services;
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [viewportDimensions, setViewportDimensions] = useState({
    width: DEFAULT_SIZE,
    height: DEFAULT_HEIGHT,
  });

  const warningState = customizationService.getCustomization('viewportDownload.warningMessage') as {
    enabled: boolean;
    value: string;
  };

  const refViewportEnabledElementOHIF = OHIFgetEnabledElement(activeViewportIdProp);
  const activeViewportElement = refViewportEnabledElementOHIF?.element;
  const { viewportId: activeViewportId, renderingEngineId } =
    getEnabledElement(activeViewportElement);

  const renderingEngine = cornerstoneViewportService.getRenderingEngine();
  const toolGroup = ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId);

  useEffect(() => {
    const toolModeAndBindings = Object.keys(toolGroup.toolOptions).reduce((acc, toolName) => {
      const tool = toolGroup.toolOptions[toolName];
      const { mode, bindings } = tool;

      return {
        ...acc,
        [toolName]: { mode, bindings },
      };
    }, {});

    return () => {
      Object.keys(toolModeAndBindings).forEach(toolName => {
        const { mode, bindings } = toolModeAndBindings[toolName];
        toolGroup.setToolMode(toolName, mode, { bindings });
      });
    };
  }, []);

  const handleEnableViewport = (viewportElement: HTMLElement) => {
    if (!viewportElement) {
      return;
    }

    const { viewport } = getEnabledElement(activeViewportElement);

    const viewportInput = {
      viewportId: VIEWPORT_ID,
      element: viewportElement,
      type: viewport.type,
      defaultOptions: {
        background: viewport.defaultOptions.background,
        orientation: viewport.defaultOptions.orientation,
      },
    };

    renderingEngine.enableElement(viewportInput);
  };

  const handleDisableViewport = async () => {
    renderingEngine.disableElement(VIEWPORT_ID);
  };

  const handleLoadImage = async (width: number, height: number) => {
    if (!activeViewportElement) {
      return;
    }

    const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
    if (!activeViewportEnabledElement) {
      return;
    }

    const segmentationRepresentations =
      segmentation.state.getViewportSegmentationRepresentations(activeViewportId);

    const { viewport } = activeViewportEnabledElement;
    const downloadViewport = renderingEngine.getViewport(VIEWPORT_ID);

    try {
      if (downloadViewport instanceof StackViewport) {
        const imageId = viewport.getCurrentImageId();
        const properties = viewport.getProperties();

        await downloadViewport.setStack([imageId]);
        downloadViewport.setProperties(properties);
      } else if (downloadViewport instanceof BaseVolumeViewport) {
        const volumeIds = viewport.getAllVolumeIds();
        downloadViewport.setVolumes([{ volumeId: volumeIds[0] }]);
      }

      if (segmentationRepresentations.length > 0) {
        segmentationRepresentations.forEach(segRepresentation => {
          const { segmentationId, colorLUTIndex, type } = segRepresentation;
          if (type === Enums.SegmentationRepresentations.Labelmap) {
            segmentation.addLabelmapRepresentationToViewportMap({
              [downloadViewport.id]: [
                {
                  segmentationId,
                  type: Enums.SegmentationRepresentations.Labelmap,
                  config: {
                    colorLUTOrIndex: colorLUTIndex,
                  },
                },
              ],
            });
          }

          if (type === Enums.SegmentationRepresentations.Contour) {
            segmentation.addContourRepresentationToViewportMap({
              [downloadViewport.id]: [
                {
                  segmentationId,
                  type: Enums.SegmentationRepresentations.Contour,
                  config: {
                    colorLUTOrIndex: colorLUTIndex,
                  },
                },
              ],
            });
          }
        });
      }

      return {
        width: Math.min(width || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
        height: Math.min(height || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
      };
    } catch (error) {
      console.error('Error loading image:', error);
    }
  };

  const handleToggleAnnotations = (show: boolean) => {
    const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
    if (!activeViewportEnabledElement) {
      return;
    }

    const downloadViewport = renderingEngine.getViewport(VIEWPORT_ID);
    if (!downloadViewport) {
      return;
    }

    const { viewportId: activeViewportId, renderingEngineId } = activeViewportEnabledElement;
    const { id: downloadViewportId } = downloadViewport;

    const toolGroup = ToolGroupManager.getToolGroupForViewport(activeViewportId, renderingEngineId);
    toolGroup.addViewport(downloadViewportId, renderingEngineId);

    Object.keys(toolGroup.getToolInstances()).forEach(toolName => {
      if (show && toolName !== 'Crosshairs') {
        try {
          toolGroup.setToolEnabled(toolName);
        } catch (error) {
          console.debug('Error enabling tool:', error);
        }
      } else {
        toolGroup.setToolDisabled(toolName);
      }
    });
  };

  useEffect(() => {
    if (viewportDimensions.width && viewportDimensions.height) {
      setTimeout(() => {
        handleLoadImage(viewportDimensions.width, viewportDimensions.height);
        handleToggleAnnotations(showAnnotations);
        // we need a resize here to make suer annotations world to canvas
        // are properly calculated
        renderingEngine.resize();
        renderingEngine.render();
      }, 100);
    }
  }, [viewportDimensions, showAnnotations]);

  const handleDownload = async (filename: string, fileType: string) => {
    const divForDownloadViewport = document.querySelector(
      `div[data-viewport-uid="${VIEWPORT_ID}"]`
    );

    if (!divForDownloadViewport) {
      console.debug('No viewport found for download');
      return;
    }

    const canvas = await html2canvas(divForDownloadViewport as HTMLElement);
    const width = canvas.width;
    const height = canvas.height;

    // Crear nuevo canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    // Dibujar la imagen original
    ctx.drawImage(canvas, 0, 0);

    // Obtener metadata
    const { displaySetService } = servicesManager.services;
    const metadata = displaySetService.getMostRecentDisplaySet();

    const patientName = metadata.instance.PatientName || 'N/A';
    const patientID = metadata.instance.PatientID || 'N/A';
    const patientAge = metadata.instance.PatientAge || 'N/A';
    const patientSex = metadata.instance.PatientSex || 'N/A';
    const studyDesc = metadata.instance.StudyDescription || 'N/A';
    const studyDateRaw = metadata.instance.StudyDate || '';
    const studyTimeRaw = metadata.instance.StudyTime || '';
    const institution = metadata.instance.InstitutionName || 'N/A';

    // Formatear fecha y hora
    const studyDate = studyDateRaw
      ? `${studyDateRaw.slice(6, 8)}-${studyDateRaw.slice(4, 6)}-${studyDateRaw.slice(0, 4)}`
      : 'N/A';
    const studyTime = studyTimeRaw
      ? `${studyTimeRaw.slice(0, 2)}:${studyTimeRaw.slice(2, 4)}:${studyTimeRaw.slice(4, 6)}`
      : 'N/A';

    // Estilos
    ctx.font = '16px Arial';
    ctx.fillStyle = 'white';
    ctx.textBaseline = 'top';

    const lineSpacing = 25;
    let yLeft = 10;
    let yRight = 10;
    const marginLeft = 10;
    const marginRight = 10;
    const rightX = exportCanvas.width - marginRight; // Asegúrate de usar el width del canvas de exportación

    // Lado izquierdo
    ctx.textAlign = 'left';
    ctx.fillText(`${patientName} (${patientSex})`, marginLeft, yLeft);
    yLeft += lineSpacing;
    ctx.fillText(`ID: ${patientID}`, marginLeft, yLeft);
    yLeft += lineSpacing;
    ctx.fillText(`EDAD: ${patientAge}`, marginLeft, yLeft);
    yLeft += lineSpacing;
    ctx.fillText(`${studyDesc}`, marginLeft, yLeft);
    yLeft += lineSpacing;

    // Lado derecho
    ctx.textAlign = 'right';
    ctx.fillText(`${institution}`, rightX, yRight);
    yRight += lineSpacing;
    ctx.fillText(`FECHA: ${studyDate}`, rightX, yRight);
    yRight += lineSpacing;
    ctx.fillText(`HORA: ${studyTime}`, rightX, yRight);
    yRight += lineSpacing;

    // Descargar imagen final
    const link = document.createElement('a');
    link.download = `${filename}.${fileType}`;
    link.href = exportCanvas.toDataURL(`image/${fileType}`, 1.0);
    link.click();
  };

  const ViewportDownloadFormNew = customizationService.getCustomization(
    'ohif.captureViewportModal'
  );

  return (
    <ViewportDownloadFormNew
      onClose={hide}
      defaultSize={DEFAULT_SIZE}
      fileTypeOptions={FILE_TYPE_OPTIONS}
      viewportId={VIEWPORT_ID}
      showAnnotations={showAnnotations}
      onAnnotationsChange={setShowAnnotations}
      dimensions={viewportDimensions}
      onDimensionsChange={setViewportDimensions}
      onEnableViewport={handleEnableViewport}
      onDisableViewport={handleDisableViewport}
      onDownload={handleDownload}
      warningState={false}
    />
  );
};

export default CornerstoneViewportDownloadForm;
