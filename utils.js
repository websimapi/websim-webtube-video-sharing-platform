// Utility functions for formatting and data manipulation

export const formatDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getVideoDuration = (file) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.style.display = 'none';
        document.body.appendChild(video);
        
        video.onloadedmetadata = () => {
            const duration = Math.round(video.duration);
            document.body.removeChild(video);
            URL.revokeObjectURL(video.src);
            resolve(duration);
        };
        
        video.onerror = () => {
            document.body.removeChild(video);
            URL.revokeObjectURL(video.src);
            resolve(0); // Default to 0 if can't get duration
        };
        
        video.src = URL.createObjectURL(file);
    });
};

export const extractVideoFramesFromUrl = async (videoUrl) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const frames = [];
        
        // Add video to DOM for better browser compatibility
        video.style.display = 'none';
        video.crossOrigin = 'anonymous'; // Allow cross-origin video loading
        document.body.appendChild(video);
        
        video.onloadedmetadata = () => {
            const duration = Math.min(video.duration, 600); // Max 10 minutes
            const frameInterval = 15; // Every 15 seconds
            const totalFrames = Math.floor(duration / frameInterval);
            
            canvas.width = 320;
            canvas.height = 180;
            
            let frameCount = 0;
            
            const captureFrame = () => {
                if (frameCount >= totalFrames) {
                    document.body.removeChild(video);
                    resolve(frames);
                    return;
                }
                
                const time = frameCount * frameInterval;
                video.currentTime = time;
                
                video.onseeked = () => {
                    try {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                        frames.push(dataUrl);
                        frameCount++;
                        setTimeout(captureFrame, 100); // Small delay for stability
                    } catch (error) {
                        console.error('Frame capture error:', error);
                        frameCount++;
                        setTimeout(captureFrame, 100);
                    }
                };
            };
            
            if (totalFrames > 0) {
                captureFrame();
            } else {
                document.body.removeChild(video);
                resolve([]);
            }
        };
        
        video.onerror = (error) => {
            document.body.removeChild(video);
            reject(new Error('Failed to load video for processing'));
        };
        
        video.src = videoUrl;
        video.load();
    });
};