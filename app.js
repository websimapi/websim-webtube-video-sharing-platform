const { useState, useEffect, useRef } = React;

import { 
    formatDuration, 
    formatFileSize, 
    extractVideoFramesFromUrl, 
    getVideoDuration, 
    uploadWithRetry, 
    moderateContent, 
    createDatabaseRecord, 
    saveLocalVideo, 
    loadLocalVideos 
} from './utils.js';

// Initialize WebsimSocket
const room = new WebsimSocket();

function WebTubeApp() {
    const [videos, setVideos] = useState([]);
    const [localVideos, setLocalVideos] = useState([]);
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({ progress: 0, status: '' });
    const [error, setError] = useState('');
    const [uploadForm, setUploadForm] = useState({ title: '', description: '' });
    const [activeTab, setActiveTab] = useState('browse');
    const [editingVideo, setEditingVideo] = useState(null);
    const [editForm, setEditForm] = useState({ title: '', description: '' });
    const fileInputRef = useRef();

    // Subscribe to video records
    const videoRecords = React.useSyncExternalStore(
        room.collection('video').subscribe,
        room.collection('video').getList
    );

    useEffect(() => {
        setVideos(videoRecords.reverse());
        loadLocalVideos(setLocalVideos);
    }, [videoRecords]);

    const handleFileUpload = async (file) => {
        if (!file) return;
        
        console.log('Starting upload for file:', file.name);
        
        if (!file.type.startsWith('video/')) {
            setError('Please upload a video file');
            return;
        }
        
        if (file.size > 100 * 1024 * 1024) {
            setError('Video file too large (max 100MB)');
            return;
        }

        if (!uploadForm.title.trim()) {
            setError('Please enter a video title');
            return;
        }

        setUploading(true);
        setError('');
        setUploadProgress({ progress: 10, status: 'Processing video...' });

        try {
            console.log('Extracting frames...');
            const frames = await extractVideoFramesFromUrl(URL.createObjectURL(file));
            console.log('Extracted frames:', frames.length);
            
            let ageRating = 'E';
            if (frames.length > 0) {
                ageRating = await moderateContent(frames, setUploadProgress);
            }

            setUploadProgress({ progress: 80, status: 'Uploading video...' });

            let videoUrl;
            try {
                videoUrl = await uploadWithRetry(file, 3, 1000, setUploadProgress);
                if (!videoUrl || typeof videoUrl !== 'string') {
                    throw new Error('Upload failed - invalid response');
                }
                if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
                    throw new Error('Upload failed - received invalid URL format');
                }
            } catch (uploadError) {
                console.error('Upload API error:', uploadError);
                throw new Error('Upload failed after multiple attempts - please try again later');
            }

            console.log('Upload successful, URL:', videoUrl);
            
            const duration = await getVideoDuration(file);

            const videoData = {
                title: uploadForm.title.trim(),
                description: uploadForm.description.trim(),
                video_url: videoUrl,
                duration: duration,
                file_size: file.size,
                thumbnail_url: frames.length > 0 ? frames[0] : null,
                age_rating: ageRating
            };

            saveLocalVideo(videoData, setLocalVideos);

            try {
                console.log('Creating database record...');
                await createDatabaseRecord(room, videoData, 3, setUploadProgress);
                setUploadProgress({ progress: 100, status: 'Upload complete!' });
            } catch (dbError) {
                console.warn('Database save failed, but video saved locally:', dbError.message);
                setUploadProgress({ progress: 100, status: 'Upload complete! (Saved locally - use resync to add to database)' });
            }
            
            setUploadForm({ title: '', description: '' });
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            
            setTimeout(() => {
                setUploading(false);
                setUploadProgress({ progress: 0, status: '' });
            }, 3000);

        } catch (error) {
            console.error('Upload error:', error);
            setError(error.message || 'Upload failed. Please try again.');
            setUploading(false);
            setUploadProgress({ progress: 0, status: '' });
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        handleFileUpload(file);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const getUserVideos = () => {
        const currentUser = 'guest';
        return localVideos;
    };

    const getTotalDuration = () => {
        return getUserVideos().reduce((total, video) => total + (video.duration || 0), 0);
    };

    const getTotalFileSize = () => {
        return getUserVideos().reduce((total, video) => total + (video.file_size || 0), 0);
    };

    const openEditModal = (video) => {
        setEditingVideo(video);
        setEditForm({
            title: video.title,
            description: video.description || ''
        });
    };

    const closeEditModal = () => {
        setEditingVideo(null);
        setEditForm({ title: '', description: '' });
    };

    const saveVideoEdit = async () => {
        if (!editForm.title.trim()) {
            alert('Title is required');
            return;
        }

        const stored = localStorage.getItem('webtube_videos') || '[]';
        const localVids = JSON.parse(stored);
        const updatedVids = localVids.map(video => 
            video.video_url === editingVideo.video_url 
                ? { ...video, title: editForm.title.trim(), description: editForm.description.trim() }
                : video
        );
        localStorage.setItem('webtube_videos', JSON.stringify(updatedVids));
        setLocalVideos(updatedVids);

        const databaseVideo = videos.find(v => v.video_url === editingVideo.video_url);
        if (databaseVideo) {
            try {
                await room.collection('video').delete(databaseVideo.id);
                
                await room.collection('video').create({
                    ...databaseVideo,
                    title: editForm.title.trim(),
                    description: editForm.description.trim()
                });
                
                console.log('Successfully updated video in database');
            } catch (error) {
                console.warn('Failed to update database record:', error);
            }
        }

        closeEditModal();
    };

    const deleteVideo = (video) => {
        if (!confirm('Are you sure you want to delete this video?')) {
            return;
        }

        const stored = localStorage.getItem('webtube_videos') || '[]';
        const localVids = JSON.parse(stored);
        const updatedVids = localVids.filter(v => v.video_url !== video.video_url);
        localStorage.setItem('webtube_videos', JSON.stringify(updatedVids));
        setLocalVideos(updatedVids);

        const databaseVideo = videos.find(v => v.video_url === video.video_url);
        if (databaseVideo) {
            room.collection('video').delete(databaseVideo.id).catch(error => {
                console.warn('Failed to delete from database (this is normal):', error);
            });
        }
    };

    const resyncVideo = async (localVideo) => {
        try {
            console.log('Resyncing video:', localVideo.title);
            
            const frames = await extractVideoFramesFromUrl(localVideo.video_url);
            console.log('Re-extracted frames for resync:', frames.length);
            
            let ageRating = 'E';
            if (frames.length > 0) {
                ageRating = await moderateContent(frames, setUploadProgress);
                console.log('New age rating for resync:', ageRating);
            }
            
            await createDatabaseRecord(room, {
                title: localVideo.title,
                description: localVideo.description,
                video_url: localVideo.video_url,
                duration: localVideo.duration,
                file_size: localVideo.file_size,
                thumbnail_url: localVideo.thumbnail_url,
                age_rating: ageRating
            }, 3, setUploadProgress);
            
            console.log('Video resynced successfully with new age rating:', ageRating);
        } catch (error) {
            console.error('Resync failed:', error);
            alert('Resync failed: ' + error.message);
        }
    };

    const getLocalVideosNotInDatabase = () => {
        const databaseUrls = new Set(videos.map(v => v.video_url));
        return localVideos.filter(lv => !databaseUrls.has(lv.video_url));
    };

    return (
        <div className="app">
            <header className="header">
                <div className="logo">
                    📺 WebTube
                </div>
                <div style={{fontSize: '14px', color: '#aaa'}}>
                    Powered by WebSim
                </div>
            </header>

            <div className="tabs">
                <button 
                    className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
                    onClick={() => setActiveTab('browse')}
                >
                    🏠 Browse
                </button>
                <button 
                    className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                >
                    📊 Creator Dashboard
                </button>
            </div>

            {activeTab === 'browse' && (
                <BrowseTab 
                    uploadForm={uploadForm}
                    setUploadForm={setUploadForm}
                    uploading={uploading}
                    handleDrop={handleDrop}
                    handleDragOver={handleDragOver}
                    fileInputRef={fileInputRef}
                    handleFileUpload={handleFileUpload}
                    uploadProgress={uploadProgress}
                    error={error}
                    getLocalVideosNotInDatabase={getLocalVideosNotInDatabase}
                    resyncVideo={resyncVideo}
                    videos={videos}
                    setSelectedVideo={setSelectedVideo}
                    formatDuration={formatDuration}
                    formatFileSize={formatFileSize}
                />
            )}
            {activeTab === 'dashboard' && (
                <CreatorDashboard 
                    getUserVideos={getUserVideos}
                    getTotalDuration={getTotalDuration}
                    getTotalFileSize={getTotalFileSize}
                    getLocalVideosNotInDatabase={getLocalVideosNotInDatabase}
                    videos={videos}
                    openEditModal={openEditModal}
                    resyncVideo={resyncVideo}
                    deleteVideo={deleteVideo}
                    formatDuration={formatDuration}
                    formatFileSize={formatFileSize}
                />
            )}

            {selectedVideo && (
                <VideoModal 
                    selectedVideo={selectedVideo}
                    setSelectedVideo={setSelectedVideo}
                    formatDuration={formatDuration}
                    formatFileSize={formatFileSize}
                />
            )}

            {editingVideo && (
                <EditModal 
                    editingVideo={editingVideo}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    closeEditModal={closeEditModal}
                    saveVideoEdit={saveVideoEdit}
                />
            )}
        </div>
    );
}

function BrowseTab(props) {
    const { 
        uploadForm, setUploadForm, uploading, handleDrop, handleDragOver, 
        fileInputRef, handleFileUpload, uploadProgress, error, 
        getLocalVideosNotInDatabase, resyncVideo, videos, setSelectedVideo,
        formatDuration, formatFileSize 
    } = props;

    return (
        <div className="tab-content">
            <div className="warning-banner">
                ⚠️ Videos are temporarily stored in our database due to entry limits. 
                Your videos are also saved locally and can be re-synced if removed from the database.
            </div>

            <div className="upload-section">
                <div className="input-group">
                    <label htmlFor="title">Video Title *</label>
                    <input
                        type="text"
                        id="title"
                        value={uploadForm.title}
                        onChange={(e) => setUploadForm({...uploadForm, title: e.target.value})}
                        placeholder="Enter video title..."
                        disabled={uploading}
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="description">Description</label>
                    <input
                        type="text"
                        id="description"
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
                        placeholder="Enter video description..."
                        disabled={uploading}
                    />
                </div>

                <div 
                    className="upload-area"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => !uploading && fileInputRef.current?.click()}
                >
                    <div className="upload-icon">📹</div>
                    <h3>Upload Video</h3>
                    <p>Drag and drop a video file here, or click to browse</p>
                    <p style={{fontSize: '12px', color: '#888', marginTop: '8px'}}>
                        Max 10 minutes, 100MB. Content is automatically moderated.
                    </p>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={(e) => handleFileUpload(e.target.files[0])}
                    disabled={uploading}
                />

                {uploading && (
                    <div className="upload-progress">
                        <div className="progress-bar" style={{width: `${uploadProgress.progress}%`}}></div>
                        <div className="progress-text">{uploadProgress.status}</div>
                    </div>
                )}

                {error && (
                    <div className="error-message">{error}</div>
                )}
            </div>

            {getLocalVideosNotInDatabase().length > 0 && (
                <div className="local-videos-section">
                    <div className="section-title">
                        💾 Local Videos (Not in Database)
                        <button 
                            className="resync-btn"
                            onClick={() => getLocalVideosNotInDatabase().forEach(resyncVideo)}
                        >
                            Resync All
                        </button>
                    </div>
                    <div className="videos-grid">
                        {getLocalVideosNotInDatabase().map((video, index) => (
                            <VideoCard 
                                key={index} 
                                video={video} 
                                onVideoClick={setSelectedVideo}
                                onResyncClick={resyncVideo}
                                formatDuration={formatDuration}
                                formatFileSize={formatFileSize}
                                showResyncButton={true}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div style={{margin: '16px', padding: '24px'}}>
                <div className="section-title">
                    🎬 Recent Videos ({videos.length})
                </div>
                <div className="videos-grid">
                    {videos.map((video) => (
                        <VideoCard 
                            key={video.id} 
                            video={video} 
                            onVideoClick={setSelectedVideo}
                            formatDuration={formatDuration}
                            formatFileSize={formatFileSize}
                            showResyncButton={false}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function CreatorDashboard(props) {
    const { 
        getUserVideos, getTotalDuration, getTotalFileSize, 
        getLocalVideosNotInDatabase, videos, openEditModal, 
        resyncVideo, deleteVideo, formatDuration, formatFileSize 
    } = props;

    const userVideos = getUserVideos();
    const totalDuration = getTotalDuration();
    const totalSize = getTotalFileSize();

    return (
        <div className="tab-content">
            <div className="creator-dashboard">
                <h2 style={{marginBottom: '24px', color: '#fff'}}>📊 Creator Dashboard</h2>
                
                <div className="dashboard-stats">
                    <div className="stat-card">
                        <div className="stat-number">{userVideos.length}</div>
                        <div className="stat-label">Total Videos</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-number">{formatDuration(totalDuration)}</div>
                        <div className="stat-label">Total Duration</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-number">{formatFileSize(totalSize)}</div>
                        <div className="stat-label">Total Size</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-number">{getLocalVideosNotInDatabase().length}</div>
                        <div className="stat-label">Pending Sync</div>
                    </div>
                </div>

                <h3 style={{marginBottom: '16px', color: '#fff'}}>📁 My Videos</h3>
                
                {userVideos.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📹</div>
                        <h3>No videos uploaded yet</h3>
                        <p>Switch to the Browse tab to upload your first video!</p>
                    </div>
                ) : (
                    <div className="my-videos-list">
                        {userVideos.map((video, index) => {
                            const isInDatabase = videos.some(v => v.video_url === video.video_url);
                            return (
                                <VideoListItem 
                                    key={index}
                                    video={video}
                                    isInDatabase={isInDatabase}
                                    onEdit={openEditModal}
                                    onResync={resyncVideo}
                                    onDelete={deleteVideo}
                                    formatDuration={formatDuration}
                                    formatFileSize={formatFileSize}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function VideoCard({ video, onVideoClick, onResyncClick, formatDuration, formatFileSize, showResyncButton }) {
    return (
        <div className="video-card" onClick={() => onVideoClick(video)}>
            {video.thumbnail_url && (
                <img 
                    src={video.thumbnail_url} 
                    alt={video.title}
                    className="video-thumbnail"
                />
            )}
            <div className="video-info">
                <div className="video-title">{video.title}</div>
                <div className="video-meta">
                    {video.username && (
                        <>
                            <img 
                                src={`https://images.websim.com/avatar/${video.username}`}
                                alt={video.username}
                                className="user-avatar"
                            />
                            <span>{video.username}</span>
                            <span>•</span>
                        </>
                    )}
                    <span>{formatDuration(video.duration)}</span>
                    <span>•</span>
                    <span>{formatFileSize(video.file_size)}</span>
                    {video.age_rating && (
                        <>
                            <span>•</span>
                            <span style={{background: '#333', padding: '2px 6px', borderRadius: '4px', fontSize: '11px'}}>
                                {video.age_rating}
                            </span>
                        </>
                    )}
                    {showResyncButton && (
                        <button 
                            className="resync-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                onResyncClick(video);
                            }}
                        >
                            Resync
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function VideoListItem({ video, isInDatabase, onEdit, onResync, onDelete, formatDuration, formatFileSize }) {
    return (
        <div className="video-item">
            {video.thumbnail_url && (
                <img 
                    src={video.thumbnail_url} 
                    alt={video.title}
                    className="video-item-thumbnail"
                />
            )}
            <div className="video-item-info">
                <div className="video-item-title">{video.title}</div>
                <div className="video-item-meta">
                    {formatDuration(video.duration)} • {formatFileSize(video.file_size)}
                    {video.age_rating && ` • Rated ${video.age_rating}`}
                    {!isInDatabase && (
                        <span style={{color: '#ff6b35', marginLeft: '8px'}}>
                            • Not in database
                        </span>
                    )}
                </div>
                {video.description && (
                    <div className="video-item-description">
                        {video.description.length > 100 
                            ? video.description.substring(0, 100) + '...' 
                            : video.description}
                    </div>
                )}
            </div>
            <div className="video-item-actions">
                <button 
                    className="btn-small btn-edit"
                    onClick={() => onEdit(video)}
                >
                    ✏️ Edit
                </button>
                {!isInDatabase && (
                    <button 
                        className="btn-small resync-btn"
                        onClick={() => onResync(video)}
                    >
                        🔄 Sync
                    </button>
                )}
                <button 
                    className="btn-small btn-delete"
                    onClick={() => onDelete(video)}
                >
                    🗑️ Delete
                </button>
            </div>
        </div>
    );
}

function VideoModal({ selectedVideo, setSelectedVideo, formatDuration, formatFileSize }) {
    return (
        <div className="modal" onClick={() => setSelectedVideo(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="close-btn" onClick={() => setSelectedVideo(null)}>×</div>
                <video 
                    className="video-player" 
                    controls 
                    autoPlay
                    src={selectedVideo.video_url}
                >
                    Your browser does not support the video tag.
                </video>
                <h3 style={{marginTop: '16px'}}>{selectedVideo.title}</h3>
                {selectedVideo.description && (
                    <p style={{color: '#aaa', marginTop: '8px'}}>{selectedVideo.description}</p>
                )}
                <div style={{color: '#aaa', fontSize: '12px', marginTop: '8px'}}>
                    Uploaded by {selectedVideo.username} • {formatDuration(selectedVideo.duration)} • {formatFileSize(selectedVideo.file_size)}
                    {selectedVideo.age_rating && ` • Rated ${selectedVideo.age_rating}`}
                </div>
            </div>
        </div>
    );
}

function EditModal({ editingVideo, editForm, setEditForm, closeEditModal, saveVideoEdit }) {
    return (
        <div className="edit-modal" onClick={closeEditModal}>
            <div className="edit-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="close-btn" onClick={closeEditModal}>×</div>
                <h3 style={{marginBottom: '16px', color: '#fff'}}>Edit Video</h3>
                
                <div className="edit-form">
                    <div className="input-group">
                        <label htmlFor="edit-title">Title *</label>
                        <input
                            type="text"
                            id="edit-title"
                            value={editForm.title}
                            onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                            placeholder="Enter video title..."
                        />
                    </div>

                    <div className="input-group">
                        <label htmlFor="edit-description">Description</label>
                        <textarea
                            id="edit-description"
                            value={editForm.description}
                            onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                            placeholder="Enter video description..."
                        />
                    </div>
                </div>

                <div className="edit-actions">
                    <button className="btn-cancel" onClick={closeEditModal}>
                        Cancel
                    </button>
                    <button className="btn-save" onClick={saveVideoEdit}>
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}

window.WebTubeApp = WebTubeApp;