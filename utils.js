// Utility functions for WebTube

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

export const extractVideoFramesFromUrl = async (videoUrl) => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const frames = [];
        
        video.style.display = 'none';
        video.crossOrigin = 'anonymous';
        document.body.appendChild(video);
        
        video.onloadedmetadata = () => {
            const duration = Math.min(video.duration, 600);
            const frameInterval = 15;
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
                        setTimeout(captureFrame, 100);
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
            resolve(0);
        };
        
        video.src = URL.createObjectURL(file);
    });
};

export const uploadWithRetry = async (file, maxRetries = 3, baseDelay = 1000, setUploadProgress) => {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            setUploadProgress({ 
                progress: 80 + (attempt * 5), 
                status: attempt > 0 ? `Retrying upload (${attempt + 1}/${maxRetries})...` : 'Uploading video...' 
            });
            
            const result = await websim.upload(file);
            
            if (!result) {
                throw new Error('Upload returned null or undefined');
            }
            
            if (typeof result !== 'string') {
                throw new Error('Upload returned non-string result');
            }
            
            if (result.trim().startsWith('<') || result.includes('<!DOCTYPE')) {
                throw new Error('Upload service returned HTML error page instead of URL');
            }
            
            if (!result.startsWith('http://') && !result.startsWith('https://')) {
                throw new Error(`Invalid URL format received: ${result.substring(0, 50)}`);
            }
            
            return result;
            
        } catch (error) {
            lastError = error;
            console.log(`Upload attempt ${attempt + 1} failed:`, error.message);
            
            if (attempt === maxRetries - 1) {
                break;
            }
            
            const delay = baseDelay * Math.pow(2, attempt) * (error.message.includes('HTML') ? 2 : 1);
            console.log(`Waiting ${delay}ms before retry...`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error(`Upload failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
};

export const moderateContent = async (frames, setUploadProgress) => {
    setUploadProgress({ progress: 30, status: 'Analyzing content for safety...' });
    
    let overallRating = 'E';
    const ratingHierarchy = ['E', 'E10+', 'T', 'M', '18+'];
    
    for (let i = 0; i < frames.length; i++) {
        try {
            const completion = await websim.chat.completions.create({
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Analyze this video frame and provide a detailed description of what you see, then assign an age rating.

Age Rating Scale:
- E (Everyone): Suitable for all ages, no objectionable content
- E10+ (Everyone 10+): Mild cartoon violence or minimal suggestive themes
- T (Teen): Moderate violence, suggestive themes, mild language
- M (Mature 17+): Intense violence, sexual themes, strong language
- 18+ (Adults Only): Graphic violence, explicit sexual content, or other adult material

Respond with JSON only: {
  "description": "detailed description of what you see in the frame",
  "age_rating": "E|E10+|T|M|18+",
  "reasoning": "explanation for the age rating assigned"
}`
                        },
                        {
                            type: "image_url",
                            image_url: { url: frames[i] }
                        }
                    ]
                }],
                json: true
            });

            const result = JSON.parse(completion.content);
            console.log(`Frame ${i + 1} analysis:`, result);
            
            if (result.age_rating === "18+") {
                throw new Error(`18+ content detected in frame ${i + 1}: ${result.reasoning}`);
            }
            
            const currentIndex = ratingHierarchy.indexOf(result.age_rating);
            const overallIndex = ratingHierarchy.indexOf(overallRating);
            if (currentIndex > overallIndex) {
                overallRating = result.age_rating;
            }
            
            setUploadProgress({ 
                progress: 30 + (i + 1) / frames.length * 40, 
                status: `Analyzing frame ${i + 1}/${frames.length} (${result.age_rating})...` 
            });
        } catch (error) {
            throw new Error(error.message || 'Content moderation failed');
        }
    }
    
    console.log(`Video overall age rating: ${overallRating}`);
    return overallRating;
};

export const createDatabaseRecord = async (room, videoData, maxRetries = 3, setUploadProgress) => {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            setUploadProgress({ 
                progress: 90 + (attempt * 2), 
                status: attempt > 0 ? `Saving to database (retry ${attempt + 1}/${maxRetries})...` : 'Saving to database...' 
            });
            
            const record = await Promise.race([
                room.collection('video').create(videoData),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Database operation timed out')), 10000)
                )
            ]);
            
            return record;
            
        } catch (error) {
            lastError = error;
            console.log(`Database save attempt ${attempt + 1} failed:`, error.message);
            
            if (attempt === maxRetries - 1) {
                break;
            }
            
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
};

export const saveLocalVideo = (videoData, setLocalVideos) => {
    if (!videoData.video_url || (!videoData.video_url.startsWith('http://') && !videoData.video_url.startsWith('https://'))) {
        console.warn('Skipping save of video with invalid URL:', videoData.video_url);
        return;
    }
    
    const stored = localStorage.getItem('webtube_videos') || '[]';
    const localVids = JSON.parse(stored);
    localVids.push(videoData);
    localStorage.setItem('webtube_videos', JSON.stringify(localVids));
    setLocalVideos(localVids);
};

export const loadLocalVideos = (setLocalVideos) => {
    const stored = localStorage.getItem('webtube_videos');
    if (stored) {
        try {
            const allVideos = JSON.parse(stored);
            const validVideos = allVideos.filter(video => 
                video.video_url && 
                (video.video_url.startsWith('http://') || video.video_url.startsWith('https://'))
            );
            
            if (validVideos.length !== allVideos.length) {
                localStorage.setItem('webtube_videos', JSON.stringify(validVideos));
                console.log(`Cleaned up ${allVideos.length - validVideos.length} broken video URLs from localStorage`);
            }
            
            setLocalVideos(validVideos);
        } catch (error) {
            console.error('Error loading local videos:', error);
            setLocalVideos([]);
        }
    } else {
        setLocalVideos([]);
    }
};